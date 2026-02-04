import os
import glob
import subprocess
import re
import argparse
import sys

# Configuration
SESSIONS_ROOT = r"Sessions"
ANALYSIS_SCRIPT = r"rag_video_analysis.py"  # Points to the RAG script

def convert_vtt_to_txt(vtt_path):
    """
    Converts a VTT file to a TXT file formatted for the analysis tool.
    Preserves timestamps in [HH:MM:SS] format.
    """
    txt_path = os.path.splitext(vtt_path)[0] + ".txt"
    print(f"Converting VTT to TXT: {vtt_path} -> {txt_path}")
    
    with open(vtt_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    output_lines = []
    
    # Regex for VTT timestamp: 00:00:00.000 --> 00:00:05.000
    timestamp_pattern = re.compile(r'(\d{2}:\d{2}:\d{2})\.\d{3}\s-->\s.*')
    
    current_timestamp = None
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line == "WEBVTT":
            continue
        if line.isdigit(): # Sequence number
            continue
            
        timestamp_match = timestamp_pattern.match(line)
        if timestamp_match:
            current_timestamp = timestamp_match.group(1)
        else:
            # It's text
            if current_timestamp:
                output_lines.append(f"[{current_timestamp}] {line}")
                current_timestamp = None 
            else:
                output_lines.append(line)

    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(output_lines))
    
    return txt_path

def process_session_folder(folder_path):
    print(f"\nScanning folder: {folder_path}")
    
    # Find Video File (.mp4)
    mp4_files = glob.glob(os.path.join(folder_path, "*.mp4"))
    if not mp4_files:
        print("No MP4 file found. Skipping.")
        return
    
    video_path = mp4_files[0]
    print(f"Found video: {video_path}")
    
    # Find Transcript File (.vtt or .txt)
    # Priority to .vtt to convert it, or .txt if vtt missing
    vtt_files = glob.glob(os.path.join(folder_path, "*.vtt"))
    txt_files = glob.glob(os.path.join(folder_path, "*.txt"))
    
    final_transcript_path = None
    
    if vtt_files:
        final_transcript_path = convert_vtt_to_txt(vtt_files[0])
    elif txt_files:
        # Check if it's not a report file (avoid reprocessing reports)
        candidates = [f for f in txt_files if "Quality_Report" not in f and "report" not in f.lower()]
        if candidates:
            final_transcript_path = candidates[0]
            print(f"Found existing TXT transcript: {final_transcript_path}")
    
    if not final_transcript_path:
        print("No transcript file found (VTT or TXT). Skipping.")
        return

    # Define Output Report Path for RAG
    folder_name = os.path.basename(folder_path)
    # Changed suffix to distinguish RAG reports
    output_report_path = os.path.join(folder_path, f"{folder_name}_Quality_Report_RAG.txt")
    
    print(f"Running RAG Analysis...")
    print(f"Video: {video_path}")
    print(f"Transcript: {final_transcript_path}")
    print(f"Output: {output_report_path}")

    # Run the analysis script
    try:
        cmd = [
            "python", ANALYSIS_SCRIPT,
            "--input", video_path,
            "--transcript", final_transcript_path,
            "--output_report", output_report_path
        ]
        
        subprocess.run(cmd, check=True)
        print("Analysis complete.")
        
    except subprocess.CalledProcessError as e:
        print(f"Error running analysis for {folder_path}: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")

def main():
    if not os.path.exists(SESSIONS_ROOT):
        print(f"Sessions directory not found: {SESSIONS_ROOT}")
        return

    # Iterate over all subdirectories in Sessions
    items = sorted(os.listdir(SESSIONS_ROOT))
    print(f"Found {len(items)} items in Sessions directory.")
    
    for item in items:
        item_path = os.path.join(SESSIONS_ROOT, item)
        if os.path.isdir(item_path):
            process_session_folder(item_path)

if __name__ == "__main__":
    main()
