# Ischool AI Quality System

This repository contains the code for the Ischool AI Quality System, a tool designed to analyze video sessions and generate quality reports using RAG (Retrieval-Augmented Generation) techniques.

## Project Structure

- **dashboard/**: Contains the web dashboard application (Flask/Python).
- **rag_video_analysis.py**: Main script for performing RAG-based video analysis.
- **batch_rag_analysis.py**: Script for batch processing of video analysis.
- **list_models.py**: Utility script to list available models.
- **viedo_Anayllsis.py**: Script for video analysis (likely frame extraction or processing).
- **Quality_Report_RAG_*.html/json**: Generated quality reports.

## Features

- **Video Analysis**: Extracts insights from video recordings.
- **RAG Integration**: Uses retrieval-augmented generation to compare video content against quality guidelines.
- **Dashboard**: A web interface to upload sessions and view reports.
- **Quality Reporting**: Generates detailed HTML and JSON reports on session quality.

## Getting Started

1.  **Install Dependencies**:
    ```bash
    pip install -r dashboard/requirements.txt
    ```

2.  **Run the Dashboard**:
    ```bash
    cd dashboard
    python app.py
    ```

3.  **Run Analysis Manually**:
    ```bash
    python rag_video_analysis.py --input <video_path> --transcript <transcript_path> --output_report <output_path>
    ```

## License

Private Repository. All rights reserved.
