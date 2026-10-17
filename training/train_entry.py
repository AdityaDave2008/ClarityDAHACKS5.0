"""Run unchanged upstream training with an atomic checkpoint publication hook."""
import runpy
from atomic_checkpoint import save_checkpoint
import yolox.core.trainer

yolox.core.trainer.save_checkpoint = save_checkpoint
runpy.run_path('YOLOX/tools/train.py', run_name='__main__')
