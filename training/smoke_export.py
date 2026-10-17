"""GPU forward/backward, checkpoint roundtrip and static ONNX parity acceptance smoke.
This uses synthetic boxes solely for compatibility and never reports training quality.
"""
import argparse
import json
import pathlib
import time

import numpy as np
import onnx
import onnxruntime as ort
import torch
from yolox.exp import get_exp


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint', required=True)
    p.add_argument('--output', required=True, type=pathlib.Path)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(20261017)
    torch.set_num_threads(4)
    exp = get_exp(None, 'yolox-nano')
    model = exp.get_model().cuda()
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=False)['model'], strict=True)
    x = torch.rand(4, 3, 416, 416, device='cuda') * 255
    targets = torch.zeros(4, 10, 5, device='cuda')
    targets[:,0,:] = torch.tensor([0,208,208,100,150], device='cuda')
    model.train()
    optimizer = torch.optim.SGD(model.parameters(), lr=1e-5)
    start = time.monotonic()
    losses = []
    for _ in range(5):
        optimizer.zero_grad()
        loss = model(x, targets)['total_loss']
        assert torch.isfinite(loss), 'Non-finite smoke loss'
        loss.backward()
        optimizer.step()
        losses.append(float(loss.detach()))
    torch.cuda.synchronize()
    seconds = time.monotonic() - start
    model.eval()
    torch.save({'model':model.state_dict()}, args.output/'smoke_roundtrip.pth')
    clone = get_exp(None, 'yolox-nano').get_model().cuda().eval()
    clone.load_state_dict(torch.load(args.output/'smoke_roundtrip.pth', weights_only=True)['model'], strict=True)
    with torch.no_grad():
        torch.testing.assert_close(clone(x[:1]), model(x[:1]))
    del clone
    # Restore official weights before export. Smoke mutations are NOT candidate training.
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=False)['model'], strict=True)
    model.cpu().eval()
    sample = x[:1].cpu()
    with torch.no_grad():
        reference = model(sample).numpy()
    path = args.output/'pretrained-static.onnx'
    torch.onnx.export(model, sample, path, input_names=['images'], output_names=['predictions'],
                      opset_version=17, dynamic_axes=None, dynamo=False)
    onnx.checker.check_model(onnx.load(path))
    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    result = session.run(None, {'images':sample.numpy()})[0]
    np.testing.assert_allclose(result, reference, rtol=2e-3, atol=2e-3)
    report = {'synthetic_smoke_only':True, 'losses':losses, 'five_batches_seconds':seconds,
              'output_shape':list(result.shape), 'onnx_max_abs_error':float(np.max(np.abs(result-reference))),
              'torch':torch.__version__, 'cuda':torch.version.cuda, 'gpu':torch.cuda.get_device_name(0)}
    (args.output/'preflight.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
