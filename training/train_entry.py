"""Run unchanged upstream training with an atomic checkpoint publication hook."""
import runpy
from atomic_checkpoint import save_checkpoint
import yolox.core.trainer
import yolox.data.datasets.coco
from coco_compat import cleanup_preserving_info, install_standard_evaluator

install_standard_evaluator()

_original_cleanup = yolox.data.datasets.coco.remove_useless_info
yolox.data.datasets.coco.remove_useless_info = lambda coco: cleanup_preserving_info(coco, _original_cleanup)

yolox.core.trainer.save_checkpoint = save_checkpoint
runpy.run_path('YOLOX/tools/train.py', run_name='__main__')
