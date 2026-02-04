#!/usr/bin/env python3
"""
Google Drive OAuth Download Script
===================================
Downloads files from Google Drive using OAuth 2.0 authentication.
Handles large files that require virus scan confirmation.

Setup:
1. Create OAuth 2.0 credentials in GCP Console
2. Download credentials.json or set CLIENT_ID and CLIENT_SECRET below
3. Run the script - it will open a browser for authentication
"""

import os
import sys
import json
import pickle
import io
from typing import Optional, List

# OAuth Configuration - Set your credentials here or use credentials.json
CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "YOUR_CLIENT_ID_HERE")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "YOUR_CLIENT_SECRET_HERE")

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
# Use absolute path for token to persist across directories
TOKEN_FILE = os.path.join(os.path.expanduser('~'), '.drive_oauth_token.pickle')
CREDENTIALS_FILE = 'credentials.json'

def get_credentials():
    """Get valid user credentials, prompting for auth if needed."""
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    
    creds = None
    
    # Check for existing token
    if os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, 'rb') as token:
                creds = pickle.load(token)
            print(f"✓ Using saved credentials from {TOKEN_FILE}")
        except Exception as e:
            print(f"Warning: Could not load token file: {e}")
    
    # If no valid credentials, authenticate
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("Refreshing expired token...")
            creds.refresh(Request())
            print("✓ Token refreshed successfully")
        else:
            print("No valid token found. Opening browser for authentication...")
            # Try credentials.json file first
            if os.path.exists(CREDENTIALS_FILE):
                flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            elif CLIENT_ID and CLIENT_SECRET:
                # Use inline credentials
                client_config = {
                    "installed": {
                        "client_id": CLIENT_ID,
                        "client_secret": CLIENT_SECRET,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["http://localhost"]
                    }
                }
                flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
            else:
                raise ValueError("No credentials found. Set CLIENT_SECRET or provide credentials.json")
            
            # Use headless mode if available, otherwise fallback to browser
            try:
                creds = flow.run_local_server(port=0, open_browser=True)
                print("✓ Authentication successful!")
            except Exception as e:
                print(f"Authentication error: {e}")
                raise
        
        # Save credentials for future runs
        with open(TOKEN_FILE, 'wb') as token:
            pickle.dump(creds, token)
        print(f"✓ Credentials saved to {TOKEN_FILE}")
    
    return creds


def download_file(service, file_id: str, output_path: str) -> bool:
    """Download a file from Google Drive."""
    from googleapiclient.http import MediaIoBaseDownload
    
    try:
        # Get file metadata
        file_metadata = service.files().get(fileId=file_id, fields='name,size,mimeType').execute()
        file_name = file_metadata.get('name', 'unknown')
        file_size = int(file_metadata.get('size', 0))
        
        print(f"Downloading: {file_name} ({file_size / 1024 / 1024:.1f} MB)")
        
        # Download file
        request = service.files().get_media(fileId=file_id)
        
        with open(output_path, 'wb') as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                if status:
                    print(f"  Progress: {int(status.progress() * 100)}%", end='\r')
        
        print(f"\n  Saved to: {output_path}")
        return True
        
    except Exception as e:
        print(f"Error downloading {file_id}: {e}")
        return False


def list_folder_files(service, folder_id: str) -> List[dict]:
    """List all files in a Google Drive folder."""
    files = []
    page_token = None
    
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents",
            spaces='drive',
            fields='nextPageToken, files(id, name, mimeType, size)',
            pageToken=page_token
        ).execute()
        
        files.extend(response.get('files', []))
        page_token = response.get('nextPageToken')
        
        if not page_token:
            break
    
    return files


def download_folder(folder_id: str, output_dir: str):
    """Download all files from a Google Drive folder."""
    from googleapiclient.discovery import build
    
    print("Authenticating with Google Drive...")
    creds = get_credentials()
    service = build('drive', 'v3', credentials=creds)
    
    print(f"Listing files in folder: {folder_id}")
    files = list_folder_files(service, folder_id)
    
    print(f"Found {len(files)} files")
    
    os.makedirs(output_dir, exist_ok=True)
    
    success_count = 0
    for file_info in files:
        file_id = file_info['id']
        file_name = file_info['name']
        output_path = os.path.join(output_dir, file_name)
        
        # Skip folders
        if file_info.get('mimeType') == 'application/vnd.google-apps.folder':
            print(f"Skipping folder: {file_name}")
            continue
        
        if download_file(service, file_id, output_path):
            success_count += 1
    
    print(f"\nDownloaded {success_count}/{len(files)} files to {output_dir}")
    return success_count > 0


def extract_folder_id(url: str) -> Optional[str]:
    """Extract folder ID from Google Drive URL."""
    import re
    match = re.search(r'/folders/([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)
    return None


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Download from Google Drive with OAuth")
    parser.add_argument("--drive_link", required=True, help="Google Drive folder URL")
    parser.add_argument("--output_dir", required=True, help="Output directory")
    args = parser.parse_args()
    
    folder_id = extract_folder_id(args.drive_link)
    if not folder_id:
        print(f"Error: Could not extract folder ID from URL: {args.drive_link}")
        return 1
    
    print(f"Folder ID: {folder_id}")
    print(f"Output Dir: {args.output_dir}")
    
    if not CLIENT_SECRET:
        print("\n" + "="*60)
        print("ERROR: CLIENT_SECRET not set!")
        print("="*60)
        print("\nTo use OAuth authentication:")
        print("1. Go to GCP Console > APIs & Services > Credentials")
        print("2. Find your OAuth 2.0 Client ID")
        print("3. Copy the Client Secret")
        print("4. Edit this file and set CLIENT_SECRET variable")
        print("\nAlternatively, download credentials.json from GCP Console")
        print("="*60)
        return 1
    
    try:
        success = download_folder(folder_id, args.output_dir)
        
        # Output JSON for dashboard compatibility
        result = {
            "ok": success,
            "folder_id": folder_id,
            "output_dir": args.output_dir
        }
        
        if not success:
            result["error"] = "Download failed"
        
        print(json.dumps(result))
        return 0 if success else 1
        
    except Exception as e:
        error_msg = str(e)
        print(json.dumps({"ok": False, "error": error_msg}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
