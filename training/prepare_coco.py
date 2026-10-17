"""Reproducible broad80 COCO subset. Keeps every box and the canonical category table."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import random
import shutil
import time
import urllib.request
import zipfile


def select_balanced(doc, count, seed):
    images = sorted(i['id'] for i in doc['images'])
    if not 0 < count <= len(images):
        raise ValueError('subset count outside available images')
    rng = random.Random(seed)
    groups = {c['id']: [] for c in doc['categories']}
    for ann in doc['annotations']:
        groups[ann['category_id']].append(ann['image_id'])
    for cat in groups:
        groups[cat] = sorted(set(groups[cat]))
        rng.shuffle(groups[cat])
    selected = set()
    while len(selected) < count and any(groups.values()):
        for cat in sorted(groups):
            while groups[cat] and groups[cat][-1] in selected:
                groups[cat].pop()
            if groups[cat] and len(selected) < count:
                selected.add(groups[cat].pop())
    rng.shuffle(images)
    for image in images:
        if len(selected) == count:
            break
        selected.add(image)
    return sorted(selected)


def split_validation(doc, seed):
    ids = sorted(i['id'] for i in doc['images'])
    random.Random(seed).shuffle(ids)
    middle = len(ids) // 2
    return sorted(ids[:middle]), sorted(ids[middle:])


def subset(doc, ids):
    selected = set(ids)
    return {**doc, 'images': [i for i in doc['images'] if i['id'] in selected],
            'annotations': [a for a in doc['annotations'] if a['image_id'] in selected]}


def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def audit_splits(split_hashes):
    seen_ids, seen_hashes = {}, {}
    for name, images in split_hashes.items():
        for image_id, digest in images.items():
            if image_id in seen_ids and seen_ids[image_id] != name:
                raise ValueError(f'Cross-split image ID leakage: {image_id}')
            if digest in seen_hashes and seen_hashes[digest] != name:
                raise ValueError(f'Cross-split identical image content: {image_id}')
            seen_ids[image_id] = name
            seen_hashes[digest] = name
    return {'cross_split_duplicates':0, 'removed_images':0, 'checked_images':len(seen_ids)}


def fetch(url, path):
    path = pathlib.Path(path)
    if path.exists():
        return
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, open(str(path)+'.part', 'wb') as f:
                shutil.copyfileobj(response, f)
            pathlib.Path(str(path)+'.part').replace(path)
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=pathlib.Path)
    parser.add_argument('--count', type=int, default=12000)
    parser.add_argument('--seed', type=int, default=20261017)
    args = parser.parse_args()
    root = args.root
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 25 * 1024**3:
        raise RuntimeError('Need at least 25GiB free before bounded subset download')
    archive = root / 'annotations_trainval2017.zip'
    fetch('https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip', archive)
    with zipfile.ZipFile(archive) as z:
        for name in ('annotations/instances_train2017.json', 'annotations/instances_val2017.json'):
            z.extract(name, root)
    train = json.loads((root/'annotations/instances_train2017.json').read_text())
    val = json.loads((root/'annotations/instances_val2017.json').read_text())
    val_ids, test_ids = split_validation(val, args.seed)
    splits = {'train_subset': (train, select_balanced(train, args.count, args.seed), 'train2017'),
              'val_tune': (val, val_ids, 'val2017'), 'test_final': (val, test_ids, 'val2017')}
    manifest = {'seed': args.seed, 'source': 'COCO2017', 'annotation_archive_sha256': sha256(archive),
                'note': 'All 80 categories and every annotation retained. Final test reserved until selection complete.', 'splits': {}}
    jobs = []
    for name, (doc, ids, folder) in splits.items():
        selected = subset(doc, ids)
        dest = root/'annotations'/f'{name}.json'
        dest.write_text(json.dumps(selected))
        manifest['splits'][name] = {'ids': ids, 'annotation_sha256': sha256(dest), 'images': len(ids), 'boxes': len(selected['annotations'])}
        (root/folder).mkdir(exist_ok=True)
        for image in selected['images']:
            jobs.append((f"https://s3.amazonaws.com/images.cocodataset.org/{folder}/{image['file_name']}", root/folder/image['file_name']))
    (root/'manifest.json').write_text(json.dumps(manifest, indent=2))
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for done, _ in enumerate(pool.map(lambda job: fetch(*job), jobs), 1):
            if done % 500 == 0:
                if shutil.disk_usage(root).free < 15 * 1024**3:
                    raise RuntimeError('Disk reserve breached')
                print(f'JCODE_PROGRESS {{"current":{done},"total":{len(jobs)},"unit":"images","message":"COCO subset download"}}', flush=True)
    hashes = {}
    with open(root/'image-sha256.jsonl', 'w') as f:
        for url,path in jobs:
            digest = sha256(path)
            hashes[int(path.stem)] = digest
            f.write(json.dumps({'file':str(path.relative_to(root)), 'url':url, 'sha256':digest})+'\n')
    report = audit_splits({name:{i:hashes[i] for i in ids} for name,(_,ids,_) in splits.items()})
    (root/'leakage-audit.json').write_text(json.dumps(report, indent=2))
    print('Prepared all splits and source/image hashes', flush=True)


if __name__ == '__main__':
    main()
