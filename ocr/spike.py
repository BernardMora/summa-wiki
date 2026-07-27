import time, sys, os, json
import mlx.core as mx
from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template

REPO = "sahilchachra/unlimited-ocr-8bit-mlx"
t0 = time.time()
model, processor = load(REPO)
cfg = model.config
print(f"load: {time.time()-t0:.1f}s   peak mem {mx.get_peak_memory()/1e9:.2f} GB", flush=True)

pages = [("prehistoria","pages/prehistoria.png"),
         ("capital","pages/capital.png"),
         ("onepager","pages/onepager.png")]
results = {}
for name, img in pages:
    if not os.path.exists(img): continue
    prompt = apply_chat_template(processor, cfg, "document parsing.", num_images=1)
    t = time.time()
    out = generate(model, processor, prompt, [img], max_tokens=3000, verbose=False)
    dt = time.time() - t
    text = out.text if hasattr(out, "text") else str(out)
    results[name] = {"seconds": round(dt,1), "chars": len(text), "text": text}
    print(f"\n=== {name}: {dt:.1f}s, {len(text)} chars ===", flush=True)
    print(text[:900], flush=True)
    print("...", flush=True)
print(f"\npeak memory: {mx.get_peak_memory()/1e9:.2f} GB")
json.dump(results, open("spike-results.json","w"), ensure_ascii=False, indent=1)
