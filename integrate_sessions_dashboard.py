"""
iSchool Dashboard Integration Script
=====================================
This script integrates the Sessions folder with the iSchool dashboard and RAG video analysis.

Features:
1. Scans Sessions folder for videos and transcripts
2. Generates CSV file for dashboard upload
3. Runs RAG analysis on sessions
4. Updates dashboard with results
"""

import os
import glob
import csv
import subprocess
import json
from pathlib import Path

# Configuration
SESSIONS_ROOT = r"Sessions"
DASHBOARD_CSV = r"ischool-dashboard\sessions-from-folder.csv"
RAG_SCRIPT = r"rag_video_analysis.py"

def scan_sessions_folder():
    """
    Scans the Sessions folder and extracts session information.
    Returns a list of session dictionaries.
    """
    sessions = []
    
    if not os.path.exists(SESSIONS_ROOT):
        print(f"Sessions directory not found: {SESSIONS_ROOT}")
        return sessions
    
    # Get all subdirectories
    session_folders = [f for f in os.listdir(SESSIONS_ROOT) 
                      if os.path.isdir(os.path.join(SESSIONS_ROOT, f)) and f.startswith('T-')]
    
    print(f"Found {len(session_folders)} session folders")
    
    for folder_name in sorted(session_folders):
        folder_path = os.path.join(SESSIONS_ROOT, folder_name)
        
        # Find video file
        mp4_files = glob.glob(os.path.join(folder_path, "*.mp4"))
        if not mp4_files:
            print(f"  Skipping {folder_name}: No video file found")
            continue
        
        video_path = mp4_files[0]
        video_filename = os.path.basename(video_path)
        
        # Find transcript
        vtt_files = glob.glob(os.path.join(folder_path, "*.vtt"))
        txt_files = glob.glob(os.path.join(folder_path, "*.txt"))
        
        # Filter out report files
        txt_files = [f for f in txt_files if "Quality_Report" not in f and "report" not in f.lower()]
        
        transcript_path = None
        if vtt_files:
            transcript_path = vtt_files[0]
        elif txt_files:
            transcript_path = txt_files[0]
        
        # Extract tutor ID from folder name (e.g., T-7070)
        tutor_id = folder_name
        
        # Create session entry
        session = {
            'tutor_id': tutor_id,
            'session_id': folder_name,
            'session_data': f"AI Tutoring Session - {folder_name}",
            'time_slot': "Variable",  # Can be extracted from transcript if needed
            'video_path': os.path.abspath(video_path),
            'transcript_path': os.path.abspath(transcript_path) if transcript_path else "",
            'folder_path': os.path.abspath(folder_path)
        }
        
        sessions.append(session)
        print(f"  ✓ {folder_name}: Video={video_filename}, Transcript={os.path.basename(transcript_path) if transcript_path else 'None'}")
    
    return sessions

def generate_csv_for_dashboard(sessions):
    """
    Generates a CSV file compatible with the dashboard.
    """
    if not sessions:
        print("No sessions to export")
        return None
    
    csv_path = DASHBOARD_CSV
    
    print(f"\nGenerating CSV file: {csv_path}")
    
    with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Tutor-ID', 'Session Data', 'Time slot', 'Session Id', 'Session link']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        
        for session in sessions:
            # Use file:// protocol for local video files
            session_link = f"file:///{session['video_path'].replace(os.sep, '/')}"
            
            writer.writerow({
                'Tutor-ID': session['tutor_id'],
                'Session Data': session['session_data'],
                'Time slot': session['time_slot'],
                'Session Id': session['session_id'],
                'Session link': session_link
            })
    
    print(f"✓ CSV generated with {len(sessions)} sessions")
    return csv_path

def run_rag_analysis_on_session(session):
    """
    Runs RAG analysis on a single session.
    """
    folder_name = session['session_id']
    video_path = session['video_path']
    transcript_path = session['transcript_path']
    
    if not transcript_path:
        print(f"  Skipping RAG analysis for {folder_name}: No transcript")
        return None
    
    # Define output report path
    output_report_path = os.path.join(session['folder_path'], f"{folder_name}_Quality_Report_RAG.txt")
    output_json_path = os.path.join(session['folder_path'], f"{folder_name}_Quality_Report_RAG.json")
    
    # Check if analysis already exists
    if os.path.exists(output_json_path):
        print(f"  ✓ {folder_name}: Analysis already exists")
        return output_json_path
    
    print(f"  Running RAG analysis for {folder_name}...")
    
    try:
        cmd = [
            "python", RAG_SCRIPT,
            "--input", video_path,
            "--transcript", transcript_path,
            "--output_report", output_report_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        
        if result.returncode == 0:
            print(f"  ✓ {folder_name}: Analysis complete")
            return output_json_path if os.path.exists(output_json_path) else output_report_path
        else:
            print(f"  ✗ {folder_name}: Analysis failed")
            print(f"    Error: {result.stderr[:200]}")
            return None
            
    except subprocess.TimeoutExpired:
        print(f"  ✗ {folder_name}: Analysis timed out (10 minutes)")
        return None
    except Exception as e:
        print(f"  ✗ {folder_name}: Error - {str(e)}")
        return None

def run_batch_rag_analysis(sessions, limit=None):
    """
    Runs RAG analysis on multiple sessions.
    """
    print(f"\n{'='*60}")
    print("Running RAG Analysis on Sessions")
    print(f"{'='*60}\n")
    
    sessions_to_process = sessions[:limit] if limit else sessions
    
    results = []
    for i, session in enumerate(sessions_to_process, 1):
        print(f"[{i}/{len(sessions_to_process)}] Processing {session['session_id']}...")
        result = run_rag_analysis_on_session(session)
        results.append({
            'session_id': session['session_id'],
            'result_path': result,
            'status': 'completed' if result else 'failed'
        })
    
    # Summary
    completed = sum(1 for r in results if r['status'] == 'completed')
    failed = sum(1 for r in results if r['status'] == 'failed')
    
    print(f"\n{'='*60}")
    print(f"Analysis Summary: {completed} completed, {failed} failed")
    print(f"{'='*60}\n")
    
    return results

def create_dashboard_integration_summary(sessions, analysis_results=None):
    """
    Creates a summary JSON file for dashboard integration.
    """
    summary = {
        'total_sessions': len(sessions),
        'sessions': []
    }
    
    for session in sessions:
        session_info = {
            'tutor_id': session['tutor_id'],
            'session_id': session['session_id'],
            'video_path': session['video_path'],
            'transcript_path': session['transcript_path'],
            'folder_path': session['folder_path']
        }
        
        # Add analysis results if available
        if analysis_results:
            result = next((r for r in analysis_results if r['session_id'] == session['session_id']), None)
            if result:
                session_info['analysis_status'] = result['status']
                session_info['analysis_result'] = result['result_path']
        
        summary['sessions'].append(session_info)
    
    summary_path = os.path.join('ischool-dashboard', 'sessions-summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    
    print(f"✓ Dashboard integration summary saved: {summary_path}")
    return summary_path

def main():
    """
    Main execution function.
    """
    print(f"\n{'='*60}")
    print("iSchool Dashboard Integration")
    print(f"{'='*60}\n")
    
    # Step 1: Scan Sessions folder
    print("Step 1: Scanning Sessions folder...")
    sessions = scan_sessions_folder()
    
    if not sessions:
        print("No sessions found. Exiting.")
        return
    
    # Step 2: Generate CSV for dashboard
    print("\nStep 2: Generating CSV for dashboard...")
    csv_path = generate_csv_for_dashboard(sessions)
    
    if csv_path:
        print(f"\n✓ CSV file ready for upload to dashboard:")
        print(f"  {os.path.abspath(csv_path)}")
    
    # Step 3: Ask user if they want to run RAG analysis
    print("\nStep 3: RAG Analysis")
    print("Do you want to run RAG analysis on these sessions?")
    print("Options:")
    print("  1. Skip analysis (just generate CSV)")
    print("  2. Run analysis on first 3 sessions (test)")
    print("  3. Run analysis on all sessions (may take time)")
    
    choice = input("\nEnter choice (1/2/3) [default: 1]: ").strip() or "1"
    
    analysis_results = None
    if choice == "2":
        print("\nRunning analysis on first 3 sessions...")
        analysis_results = run_batch_rag_analysis(sessions, limit=3)
    elif choice == "3":
        print("\nRunning analysis on all sessions...")
        analysis_results = run_batch_rag_analysis(sessions)
    else:
        print("\nSkipping RAG analysis")
    
    # Step 4: Create integration summary
    print("\nStep 4: Creating dashboard integration summary...")
    summary_path = create_dashboard_integration_summary(sessions, analysis_results)
    
    # Final instructions
    print(f"\n{'='*60}")
    print("Integration Complete!")
    print(f"{'='*60}\n")
    print("Next steps:")
    print(f"1. Upload CSV to dashboard: {os.path.abspath(csv_path)}")
    print(f"2. Dashboard is running at: http://localhost:3000")
    print(f"3. Integration summary: {os.path.abspath(summary_path)}")
    print("\nNote: Video links use file:// protocol for local playback")
    print("      Make sure your browser allows local file access")
    print(f"\n{'='*60}\n")

if __name__ == "__main__":
    main()
