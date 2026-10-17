"""Compatibility hooks for pinned YOLOX 0.3.0 with current pycocotools/NumPy."""


def cleanup_preserving_info(coco, cleanup):
    info = coco.dataset.get('info', {})
    cleanup(coco)
    coco.dataset['info'] = info


def category_id_for_json(value):
    return int(value)


def install_standard_evaluator():
    import yolox.layers
    from pycocotools.cocoeval import COCOeval
    yolox.layers.COCOeval_opt = COCOeval
