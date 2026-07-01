import json
import os

log_path = r"C:\Users\Admin\.gemini\antigravity-ide\brain\652afe2b-da64-4a88-b5d3-06699723b944\.system_generated\logs\transcript.jsonl"
steps_to_print = [270, 296, 302, 306, 390, 396, 404, 501]
scratch_dir = r"c:\Users\Admin\OneDrive\Desktop\product_sprint\scratch"

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            step = data.get("step_index")
            if step in steps_to_print:
                source = data.get("source")
                if source == "MODEL" and "tool_calls" in data:
                    for idx, call in enumerate(data["tool_calls"]):
                        args = call.get("args", {})
                        if isinstance(args, str):
                            args = json.loads(args)
                        
                        out_filename = os.path.join(scratch_dir, f"step_{step}_{idx}.json")
                        with open(out_filename, 'w', encoding='utf-8') as out_f:
                            json.dump(args, out_f, indent=2)
                        print(f"Dumped step {step} tool call {idx} to {out_filename}")
        except Exception as e:
            print(f"Error processing step {step}: {e}")
