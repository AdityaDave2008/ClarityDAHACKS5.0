"""Atomic artifact publication so a mirror never sees half a checkpoint."""
import os
import pathlib


def atomic_publish(destination, writer):
    destination = pathlib.Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = pathlib.Path(str(destination) + '.part')
    try:
        writer(temporary)
        with open(temporary, 'rb') as f:
            os.fsync(f.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def save_checkpoint(state, is_best, save_dir, model_name=''):
    import shutil
    import torch
    destination = pathlib.Path(save_dir) / f'{model_name}_ckpt.pth'
    atomic_publish(destination, lambda p: torch.save(state, p))
    if is_best:
        atomic_publish(pathlib.Path(save_dir)/'best_ckpt.pth', lambda p: shutil.copyfile(destination, p))
