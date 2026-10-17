"""Micro precision/recall at IoU=.50, selected only on tuning data."""
import itertools


def choose_threshold(scored_matches, positives, target=0.935):
    best = {'threshold':None, 'precision':None, 'recall':0.0, 'target_met':False,
            'target_precision':target, 'ground_truth_objects':positives}
    tp = fp = 0
    for score, group in itertools.groupby(sorted(scored_matches, reverse=True), key=lambda x:x[0]):
        for _, matched in group:
            tp += bool(matched)
            fp += not bool(matched)
        precision = tp / (tp + fp)
        recall = tp / positives if positives else 0.0
        if positives and tp and precision >= target and recall >= best['recall']:
            best = {**best, 'threshold':score, 'precision':precision, 'recall':recall,
                    'target_met':True, 'true_positives':tp, 'false_positives':fp}
    return best


def fixed_threshold(scored_matches, positives, threshold, target=0.935):
    selected = [hit for score,hit in scored_matches if score >= threshold]
    tp = sum(selected)
    fp = len(selected) - tp
    precision = tp / len(selected) if selected else None
    return {'threshold':threshold, 'precision':precision, 'recall':tp/positives if positives else None,
            'true_positives':tp, 'false_positives':fp, 'false_negatives':positives-tp,
            'ground_truth_objects':positives, 'target_precision':target,
            'target_met':bool(precision is not None and precision >= target and tp > 0)}


def matches_from_coco(evaluator, category_id=None):
    matches = []
    positives = 0
    for image in evaluator.evalImgs:
        if image is None or list(image['aRng']) != list(evaluator.params.areaRng[0]):
            continue
        if category_id is not None and image['category_id'] != category_id:
            continue
        positives += int((~image['gtIgnore'].astype(bool)).sum())
        for score, match, ignore in zip(image['dtScores'],image['dtMatches'][0],image['dtIgnore'][0]):
            if not ignore:
                matches.append((float(score), bool(match)))
    return matches, positives
