"""Official YOLOX-Nano architecture, gentle all80 COCO fine-tune."""
import os
from yolox.exp import get_exp

Base = type(get_exp(None, 'yolox-nano'))


class Exp(Base):
    def __init__(self):
        super().__init__()
        self.exp_name = 'broad80_nano'
        self.data_dir = os.environ.get('COCO_ROOT', '/workspace/broad80/coco')
        self.output_dir = os.environ.get('OUTPUT_ROOT', '/workspace/broad80/artifacts')
        self.train_ann = 'train_subset.json'
        self.val_ann = 'val_tune.json'
        self.num_classes = 80
        self.seed = 20261017
        self.max_epoch = 15
        self.warmup_epochs = 1
        self.no_aug_epochs = 3
        self.eval_interval = 1
        self.save_history_ckpt = True
        self.print_interval = 25
        self.data_num_workers = 6
        self.input_size = (416, 416)
        self.test_size = (416, 416)
        self.random_size = (13, 13)
        self.multiscale_range = 0
        self.basic_lr_per_img = 0.001 / 64.0
        self.mosaic_prob = 0.25
        self.enable_mixup = False
        self.test_conf = 0.001
