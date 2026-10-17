"""Evaluate frozen weights on COCO. Tune threshold on val_tune, never test_final."""
import argparse
import json
import pathlib
import time
import cv2
import numpy as np
import torch
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
from yolox.data.data_augment import preproc
from yolox.exp import get_exp
from yolox.utils import postprocess
from operating_point import choose_threshold, fixed_threshold, matches_from_coco


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',type=pathlib.Path,required=True)
    p.add_argument('--checkpoint',required=True)
    p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--split',choices=['val_tune','test_final'],default='val_tune')
    p.add_argument('--frozen-threshold',type=float)
    args=p.parse_args()
    if args.split=='test_final' and args.frozen_threshold is None:
        p.error('Final test requires a threshold frozen from tuning data')
    args.output.mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(4)
    exp=get_exp(None,'yolox-nano')
    model=exp.get_model().cuda().eval()
    model.load_state_dict(torch.load(args.checkpoint,map_location='cpu',weights_only=False)['model'],strict=True)
    coco=COCO(str(args.root/'annotations'/f'{args.split}.json'))
    cats=sorted(coco.getCatIds())
    predictions=[]
    start=time.monotonic()
    with torch.inference_mode():
        for index,image in enumerate(coco.dataset['images'],1):
            pixels=cv2.imread(str(args.root/'val2017'/image['file_name']))
            if pixels is None: raise RuntimeError(f"Unreadable image {image['file_name']}")
            data,ratio=preproc(pixels,(416,416))
            outputs=postprocess(model(torch.from_numpy(data).unsqueeze(0).cuda()),80,.001,.65,class_agnostic=False)[0]
            if outputs is not None:
                outputs=outputs.cpu().numpy()
                for row in outputs:
                    x1,y1,x2,y2=row[:4]/ratio
                    predictions.append({'image_id':image['id'],'category_id':cats[int(row[6])],
                        'bbox':[float(x1),float(y1),float(x2-x1),float(y2-y1)],'score':float(row[4]*row[5])})
            if index%250==0: print(f'Evaluation {index}/{len(coco.dataset["images"])}',flush=True)
    (args.output/'predictions.json').write_text(json.dumps(predictions))
    if not predictions: raise RuntimeError('No predictions at permissive threshold')
    evaluator=COCOeval(coco,coco.loadRes(predictions),'bbox')
    evaluator.evaluate(); evaluator.accumulate(); evaluator.summarize()
    matches,positives=matches_from_coco(evaluator)
    selection = choose_threshold(matches,positives) if args.split=='val_tune' else None
    threshold = (selection['threshold'] if selection['target_met'] else 0.5) if selection else args.frozen_threshold
    point = fixed_threshold(matches,positives,threshold)
    point['threshold_frozen'] = args.split=='test_final'
    point['fallback_used'] = bool(selection and not selection['target_met'])
    per_class = []
    for k,category_id in enumerate(evaluator.params.catIds):
        class_matches,support = matches_from_coco(evaluator,category_id)
        precision = evaluator.eval['precision'][:,:,k,0,-1]
        valid = precision[precision >= 0]
        valid50 = precision[0][precision[0] >= 0]
        per_class.append({'category_id':category_id,'name':coco.cats[category_id]['name'],
            'AP50_95':float(valid.mean()) if valid.size else None,
            'AP50':float(valid50.mean()) if valid50.size else None,
            **fixed_threshold(class_matches,support,threshold)})
    report={'split':args.split,'checkpoint':args.checkpoint,'mAP50_95':float(evaluator.stats[0]),
            'mAP50':float(evaluator.stats[1]),'operating_point_IoU50':point,
            'per_class':per_class, 'threshold_selection':selection, 'images':len(coco.dataset['images']),'seconds':time.monotonic()-start,
            'caution':'Held out from our fine-tuning only. Official pretrained weights may have used COCO val for selection. COCO domain only. Precision is not overall accuracy. No hazard/safety coverage claim.'}
    (args.output/'metrics.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)


if __name__=='__main__': main()
