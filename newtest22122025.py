import os
import re
import time
import glob
import shutil
import random
import argparse
import subprocess
import concurrent.futures
import google.generativeai as genai
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

# API Configuration
API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable")

# Ultra-Fast Processing Config
DEFAULT_START_TIME = "00:15:00"
FRAME_INTERVAL = 60              # Extract 1 frame every 60 seconds
FRAME_WIDTH = 480                # 480p is sufficient for AI reading & much faster
FRAME_QUALITY = 6                # JPEG Quality (2-31, lower is higher quality)
TARGET_FRAME_COUNT = 30          # 30 frames give a great overview without overloading

# Audio Optimization (Tiny file for fast upload)
AUDIO_CODEC = "libmp3lame"
AUDIO_BITRATE = "32k"            # Low bitrate is fine for speech analysis
AUDIO_SAMPLE_RATE = "16000"      # 16kHz is standard for Speech-to-Text

# Model Configuration (Using Flash for Speed)
MODEL_NAME = "gemini-1.5-flash"  # Flash is significantly faster than Pro/Preview
MODEL_CONFIG = {
    "temperature": 0.1,          # Low temp for factual compliance checking
    "top_p": 0.95,
    "max_output_tokens": 8192,
}

# Reference Files
PDF_REFERENCE_FILES = [
    "../Quality Guide for Reviewers.pdf",
    "../Quality Comments V1062025.pdf",
    "../Examples of Flag comments.pdf",
    "../Comments Bank - .pdf"
]

# ============================================================================
# CORE FUNCTIONS
# ============================================================================

genai.configure(api_key=API_KEY)

def get_timestamp_from_transcript(transcript_path):
    """Reads the first few bytes of transcript to find start time quickly."""
    if not os.path.exists(transcript_path):
        return DEFAULT_START_TIME
    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            # Read only first 2000 chars to find the first timestamp fast
            content = f.read(2000) 
            match = re.search(r'\[(\d{2}:\d{2}:\d{2})\]', content)
            if match:
                return match.group(1)
    except:
        pass
    return DEFAULT_START_TIME

def run_ffmpeg(command):
    """Helper to run ffmpeg silently."""
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def extract_resources_parallel(video_path, start_time):
    """Extracts Audio and Video concurrently using ThreadPool."""
    print(f"--- ⚡ Extracting Resources (Parallel) starting at {start_time} ---")
    
    base_dir = os.path.dirname(video_path)
    temp_dir = os.path.join(base_dir, "temp_processing")
    if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
    os.makedirs(temp_dir)

    audio_path = os.path.join(temp_dir, "audio.mp3") # MP3 is smaller than WAV
    frames_pattern = os.path.join(temp_dir, "frame_%03d.jpg")

    # Audio Command (Optimized for small size)
    # -vn: No video
    # -ac 1: Mono (Stereo not needed for speech)
    cmd_audio = [
        "ffmpeg", "-ss", start_time, "-i", video_path,
        "-vn", "-acodec", AUDIO_CODEC, "-b:a", AUDIO_BITRATE, 
        "-ac", "1", "-ar", AUDIO_SAMPLE_RATE,
        audio_path, "-y"
    ]

    # Video Command (Optimized for speed)
    # -vf fps: Fast extraction filter
    # scale=480: Downscale to speed up processing and upload
    cmd_frames = [
        "ffmpeg", "-ss", start_time, "-i", video_path,
        "-vf", f"fps=1/{FRAME_INTERVAL},scale={FRAME_WIDTH}:-1",
        "-q:v", str(FRAME_QUALITY),
        frames_pattern, "-y"
    ]

    t0 = time.time()
    # Run both FFmpeg processes at the same time
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(run_ffmpeg, cmd_audio)
        f2 = executor.submit(run_ffmpeg, cmd_frames)
        concurrent.futures.wait([f1, f2])
    
    print(f"Extraction completed in {time.time() - t0:.2f}s")
    return audio_path, temp_dir

def upload_single_file(file_info):
    """Helper for concurrent uploads."""
    path, mime = file_info
    print(f"Uploading: {os.path.basename(path)}")
    return genai.upload_file(path, mime_type=mime)

def upload_resources_concurrent(audio_path, frames_dir, transcript_path, pdf_paths):
    """Uploads all files to Gemini in parallel."""
    print(f"--- ⚡ Uploading to Gemini (Concurrent) ---")
    
    files_to_upload = [] # List of (path, mime_type)

    # 1. Audio
    files_to_upload.append((audio_path, "audio/mp3"))

    # 2. Transcript
    if os.path.exists(transcript_path):
        files_to_upload.append((transcript_path, "text/plain"))

    # 3. PDFs
    for pdf in pdf_paths:
        if os.path.exists(pdf):
            files_to_upload.append((pdf, "application/pdf"))

    # 4. Frames (Random Selection)
    all_frames = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))
    if len(all_frames) > TARGET_FRAME_COUNT:
        # Uniform sampling instead of random for better timeline coverage
        step = len(all_frames) // TARGET_FRAME_COUNT
        selected_frames = all_frames[::step][:TARGET_FRAME_COUNT]
    else:
        selected_frames = all_frames
    
    for frame in selected_frames:
        files_to_upload.append((frame, "image/jpeg"))

    uploaded_objects = []
    
    # Upload 8 files at a time
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(upload_single_file, f) for f in files_to_upload]
        for future in concurrent.futures.as_completed(futures):
            uploaded_objects.append(future.result())

    # Wait for processing (usually instant for images/text, short for audio)
    print("Verifying file readiness...")
    active_files = []
    for f in uploaded_objects:
        while f.state.name == "PROCESSING":
            time.sleep(1)
            f = genai.get_file(f.name)
        if f.state.name == "ACTIVE":
            active_files.append(f)
        else:
            print(f"Failed to process file: {f.name}")
            
    return active_files

def analyze_session(uploaded_files, output_path):
    """Sends the prompt to Gemini."""
    print("\n--- 🤖 Analyzing with Gemini 1.5 Flash ---")
    
    # The Prompt
    system_prompt = """
    You are a Senior Quality Compliance Auditor for iSchool. Perform a forensic quality review of this instructor's session using the provided Video Frames, Audio, Transcript, and Policy PDFs.

    ### 1. AUDIT PROTOCOL (Strict)
    *   **Visuals:** Is the camera ON? Is the iSchool Virtual Background used correctly?
    *   **Screen Sharing:** During the "Make/Coding" phase, did the STUDENT share their screen? (If the Tutor shares their screen during coding or uses a static slide instead of student practice, flag this as a YELLOW FLAG).
    *   **Audio:** Check for dead air (>45s). Is the tone energetic? Are technical terms pronounced correctly in English?
    *   **Timestamps:** Use the transcript to cite exact times for every issue.

    ### 2. SCORING RULES (0-5)
    *   **5 (Perfect):** No issues.
    *   **4 (Good):** 1-2 Minor notes.
    *   **3 (Fair):** 1 Yellow Flag OR 3+ Minor notes.
    *   **2 (Weak):** 2+ Yellow Flags.
    *   **1 (Critical):** Any Red Flag.

    ### 3. OUTPUT REPORT FORMAT
    **INSTRUCTOR QUALITY REPORT**
    
    **Positive Feedback**
    * [Category] - [Subcategory]: [Detail] – [Timestamp]
    * (List 3 strong points)

    **Areas for Improvement (List ALL deviations)**
    * [Category] - [Subcategory]: [Detail] – [Timestamp]

    **Flags**
    * Yellow Flag – [Subcategory]: [Reason] – [Timestamp]
    * Red Flag – [Subcategory]: [Reason] – [Timestamp]

    **Performance Scoring Table**
    (Create a table rating Setup, Attitude, Preparation, Curriculum, Teaching from 0-5)

    **Final Calculation**
    Calculate weighted score: (Setup 25%, Attitude 20%, Preparation 15%, Curriculum 15%, Teaching 25%).
    """

    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config=MODEL_CONFIG
    )

    # Prepare content: Prompt + Files
    content_payload = [system_prompt] + uploaded_files

    start_gen = time.time()
    response = model.generate_content(content_payload)
    end_gen = time.time()
    
    print(f"Analysis generated in {end_gen - start_gen:.2f}s")

    # Save Report
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(response.text)
    
    return response.usage_metadata

def cleanup(temp_dir, uploaded_files):
    """Clean local and cloud files."""
    print("--- Cleaning up ---")
    if temp_dir and os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    
    # Delete from cloud to save storage cost
    for f in uploaded_files:
        try:
            genai.delete_file(f.name)
        except:
            pass

def generate_html_report(txt_path):
    """Simple TXT to HTML converter for better readability."""
    html_path = txt_path.replace(".txt", ".html")
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    html = f"""
    <html><head><style>
        body {{ font-family: sans-serif; max-width: 900px; margin: auto; padding: 20px; background: #f4f4f9; }}
        .box {{ background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }}
        h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; }}
        pre {{ white-space: pre-wrap; font-family: inherit; font-size: 15px; }}
        .flag {{ background: #ffe6e6; padding: 2px 5px; border-radius: 3px; font-weight: bold; color: #d63031; }}
    </style></head><body>
    <div class="box"><h1>Quality Report</h1><pre>{content}</pre></div>
    <script>
    document.querySelector('pre').innerHTML = document.querySelector('pre').innerHTML
        .replace(/(Red Flag|Yellow Flag)/g, '<span class="flag">$1</span>');
    </script>
    </body></html>
    """
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=VIDEO_FILE_PATH, help="Input video")
    parser.add_argument("--output_report", default=OUTPUT_REPORT_TXT, help="Output TXT")
    parser.add_argument("--transcript", default=TRANSCRIPT_PATH, help="Transcript path")
    args = parser.parse_args()

    total_start = time.time()
    
    uploaded_files = []
    temp_dir = None

    try:
        # 1. Get Start Time
        start_time = get_timestamp_from_transcript(args.transcript)
        
        # 2. Extract (Parallel)
        audio_path, temp_dir = extract_resources_parallel(args.input, start_time)
        
        # 3. Upload (Parallel)
        uploaded_files = upload_resources_concurrent(audio_path, temp_dir, args.transcript, PDF_REFERENCE_FILES)
        
        # 4. Analyze
        usage = analyze_session(uploaded_files, args.output_report)
        
        # 5. HTML
        generate_html_report(args.output_report)
        
        total_time = time.time() - total_start
        print(f"\n✅ SUCCESS! Total Time: {total_time:.2f} seconds")
        
        if usage:
            # Estimate Cost (Flash pricing: ~$0.075 / 1M input)
            cost = (usage.prompt_token_count / 1_000_000) * 0.075
            print(f"Tokens Used: {usage.prompt_token_count} | Est. Cost: ${cost:.5f}")

    except Exception as e:
        print(f"\n❌ Error: {e}")
    finally:
        cleanup(temp_dir, uploaded_files)