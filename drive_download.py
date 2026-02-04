#!/usr/bin/env python3

import argparse
import json
import os
import sys
import re
import urllib.request
import urllib.error
from typing import List, Tuple
from io import StringIO

VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".webm"}
TRANSCRIPT_EXTS = {".txt", ".vtt", ".srt"}


def _is_drive_folder_url(url: str) -> bool:
    return "drive.google.com/drive/folders/" in url


def _walk_files(root: str) -> List[str]:
    files: List[str] = []
    for base, _, names in os.walk(root):
        for name in names:
            files.append(os.path.join(base, name))
    return files


def download_file_urllib(file_id: str, output_path: str):
    """Download a Google Drive file, handling large file confirmation."""
    # First, try direct download
    url = f"https://drive.google.com/uc?id={file_id}&export=download"
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req) as response:
            content = response.read()
            
            # Check if we got an HTML page (virus scan warning) instead of the file
            if content[:15].startswith(b'<!DOCTYPE html>') or b'Google Drive - Virus scan warning' in content[:2000]:
                print(f"Large file detected, attempting confirmation download for {file_id}...", file=sys.stderr)
                # Try with confirm parameter
                confirm_url = f"https://drive.google.com/uc?id={file_id}&export=download&confirm=t"
                req2 = urllib.request.Request(
                    confirm_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                )
                with urllib.request.urlopen(req2) as response2:
                    content = response2.read()
                    # If still HTML, the file might need authentication
                    if content[:15].startswith(b'<!DOCTYPE html>'):
                        print(f"Warning: File {file_id} may require authentication", file=sys.stderr)
                        return False
            
            with open(output_path, 'wb') as out_file:
                out_file.write(content)
            
            # Verify it's not an HTML error page
            file_size = os.path.getsize(output_path)
            if file_size < 10000:  # Less than 10KB is suspicious
                with open(output_path, 'rb') as f:
                    header = f.read(100)
                    if b'<!DOCTYPE' in header or b'<html' in header:
                        print(f"Downloaded HTML instead of video for {file_id}", file=sys.stderr)
                        return False
            return True
    except Exception as e:
        print(f"Manual download failed for {file_id}: {e}", file=sys.stderr)
        return False


def download_large_file_gdown(file_id: str, output_path: str):
    """Use gdown directly to download a large file with confirmation handling."""
    try:
        import gdown
        url = f"https://drive.google.com/uc?id={file_id}"
        print(f"Attempting gdown download for {file_id}...", file=sys.stderr)
        gdown.download(url, output_path, quiet=False, fuzzy=True, use_cookies=True)
        
        # Verify the download
        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            if file_size > 100000:  # More than 100KB is probably a real video
                print(f"Successfully downloaded {output_path} ({file_size} bytes)", file=sys.stderr)
                return True
            else:
                # Check if it's HTML
                with open(output_path, 'rb') as f:
                    header = f.read(200)
                    if b'<!DOCTYPE' in header or b'<html' in header:
                        print(f"Downloaded HTML instead of video", file=sys.stderr)
                        os.remove(output_path)
                        return False
        return False
    except Exception as e:
        print(f"gdown download failed for {file_id}: {e}", file=sys.stderr)
        return False

def main() -> int:
    parser = argparse.ArgumentParser(description="Download Google Drive file/folder to a local directory")
    parser.add_argument("--drive_link", required=True)
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    drive_link = (args.drive_link or "").strip()
    output_dir = os.path.abspath(args.output_dir)

    os.makedirs(output_dir, exist_ok=True)

    try:
        import gdown  # type: ignore
    except Exception:
        print(json.dumps({
            "ok": False,
            "error": "Missing dependency: gdown",
            "hint": "Install with: python3 -m pip install gdown",
        }))
        return 2

    log_capture = StringIO()
    
    # We want to capture stdout to parse file IDs, but we also want it to print 
    # so the parent process (if node) might see progress or we can debug.
    # We'll use a tee-like approach or just capture everything and print it back if needed, 
    # but simplest is to just redirect stdout, do work, then parse.
    
    original_stdout = sys.stdout
    sys.stdout = log_capture

    download_success = False
    error_msg = ""
    
    try:
        if _is_drive_folder_url(drive_link):
            # Print info to captured log
            print(f"Attempting to download folder: {drive_link}")
            # Use confirm=True to handle large files, use_cookies=True for auth
            gdown.download_folder(url=drive_link, output=output_dir, quiet=False, use_cookies=True)
        else:
            gdown.download(url=drive_link, output=output_dir, quiet=False, fuzzy=True, use_cookies=True)
        download_success = True
    except Exception as e:
        error_msg = str(e)
        # Don't return failure yet, try fallback
    finally:
        # Restore stdout
        sys.stdout = original_stdout
        
    captured_output = log_capture.getvalue()
    # Print captured output to real stdout for debugging/logs
    print(captured_output, file=sys.stderr)

    # Check if download really succeeded (gdown throws on some errors, but not all?)
    # If failed, or if we want to ensure everything is downloaded
    
    # Parse captured output for files
    # Output format: Processing file <ID> <Name>
    # Regex: Processing file ([a-zA-Z0-9_-]+) (.+)
    
    found_files: List[Tuple[str, str]] = re.findall(r"Processing file ([a-zA-Z0-9_-]+) (.+)", captured_output)
    
    fallback_count = 0
    if found_files:
        print(f"Identified {len(found_files)} files from gdown logs.", file=sys.stderr)
        for file_id, file_name in found_files:
            # Check if file exists. gdown might have preserved folder structure in file_name or created dirs.
            # However, the file_name in log usually is just the leaf name or relative path.
            # We will try to download to root of output_dir if missing.
            
            # Check if we can find this file anywhere
            all_current_files = _walk_files(output_dir)
            found = False
            for fpath in all_current_files:
                if file_name in fpath: # weak match
                    if os.path.getsize(fpath) > 0:
                        found = True
                        break
            
            if not found:
                print(f"File {file_name} (ID: {file_id}) missing/empty. Attempting fallback download...", file=sys.stderr)
                # Clean filename
                clean_name = os.path.basename(file_name)
                target_path = os.path.join(output_dir, clean_name)
                
                # Try gdown first for large files (videos)
                ext = os.path.splitext(clean_name)[1].lower()
                if ext in VIDEO_EXTS:
                    if download_large_file_gdown(file_id, target_path):
                        fallback_count += 1
                        print(f"Successfully downloaded {clean_name} via gdown", file=sys.stderr)
                        continue
                
                # Fallback to urllib
                if download_file_urllib(file_id, target_path):
                    fallback_count += 1
                    print(f"Successfully downloaded {clean_name}", file=sys.stderr)
                else:
                    print(f"Fallback failed for {clean_name}", file=sys.stderr)
    
    # Final verification
    all_files = _walk_files(output_dir)
    video_files = [p for p in all_files if os.path.splitext(p)[1].lower() in VIDEO_EXTS]
    transcript_files = [p for p in all_files if os.path.splitext(p)[1].lower() in TRANSCRIPT_EXTS]

    # Check for corrupted video files (HTML instead of video)
    corrupted_videos = []
    for vf in video_files:
        file_size = os.path.getsize(vf)
        if file_size < 100000:  # Less than 100KB is suspicious for a video
            with open(vf, 'rb') as f:
                header = f.read(200)
                if b'<!DOCTYPE' in header or b'<html' in header or b'Google Drive' in header:
                    corrupted_videos.append(vf)
                    print(f"[WARNING] Corrupted video detected: {vf} ({file_size} bytes) - contains HTML instead of video data", file=sys.stderr)
    
    if corrupted_videos:
        print(f"\n[ERROR] {len(corrupted_videos)} video file(s) are corrupted (HTML instead of video).", file=sys.stderr)
        print("This typically happens with large files (>100MB) that require authentication.", file=sys.stderr)
        print("Solutions:", file=sys.stderr)
        print("  1. Make sure the Google Drive folder is PUBLIC (Anyone with link can view)", file=sys.stderr)
        print("  2. Or download manually and place in the Sessions folder", file=sys.stderr)
        print("  3. Or use 'gdown --cookies' with browser cookies", file=sys.stderr)

    # Success if we have at least one file or gdown succeeded
    success = (len(all_files) > 0) or download_success

    if success:
         print(json.dumps({
            "ok": True,
            "output_dir": output_dir,
            "all_files": all_files,
            "video_files": video_files,
            "transcript_files": transcript_files,
            "fallback_recovered": fallback_count
        }))
         return 0
    else:
        print(json.dumps({
            "ok": False, 
            "error": error_msg or "Download failed and fallback failed",
            "logs": captured_output
        }))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
