import json

log_path = r"C:\Users\Admin\.gemini\antigravity-ide\brain\652afe2b-da64-4a88-b5d3-06699723b944\.system_generated\logs\transcript.jsonl"

print("Searching transcript.jsonl for early edits to admin-onboarding-ai.html...")

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            if "admin-onboarding-ai.html" in line:
                data = json.loads(line)
                step = data.get("step_index")
                if step < 578:
                    source = data.get("source")
                    type_ = data.get("type")
                    
                    if source == "MODEL" and "tool_calls" in data:
                        for call in data["tool_calls"]:
                            args = call.get("args", {})
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except:
                                    pass
                            
                            target_file = ""
                            if isinstance(args, dict):
                                target_file = args.get("TargetFile", "") or args.get("AbsolutePath", "") or str(args)
                            
                            # Only print if it's a file write/replace call
                            if "admin-onboarding-ai.html" in target_file:
                                print(f"Step {step} | Source: {source} | Type: {type_} | Tool: {call.get('name')}")
                                if isinstance(args, dict):
                                    print(f"  Instruction: {args.get('Instruction', '')}")
                                    print(f"  Description: {args.get('Description', '')}")
                                    if "ReplacementContent" in args:
                                        print(f"  ReplacementContent snippet: {args.get('ReplacementContent')[:500]}...")
                                    if "ReplacementChunks" in args:
                                        for i, chunk in enumerate(args["ReplacementChunks"]):
                                            print(f"  Chunk {i}: ReplacementContent snippet: {chunk.get('ReplacementContent')[:500]}...")
                                print("-" * 50)
        except Exception as e:
            pass

print("Search complete.")
