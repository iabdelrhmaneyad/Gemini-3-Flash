import csv
import re
import glob
import os
import statistics

# Configuration
CSV_PATH = "Quality Sessions Sample - Test Session .csv"
SESSIONS_ROOT = "Sessions"

def parse_csv(csv_path):
    data = {}
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            tutor_id = row.get("Tutor ID")
            if not tutor_id:
                continue
            
            try:
                # Handle formatted percent strings like "95%"
                score_str = row.get("Score", "0").replace("%", "").strip()
                final_score = float(score_str) if score_str else 0.0
                
                def parse_cat(val):
                    val = val.replace("%", "").strip()
                    if not val: return 0.0
                    return float(val)

                data[tutor_id] = {
                    "Human_Final": final_score,
                    "Human_Setup": parse_cat(row.get("Setup", "0")),
                    "Human_Attitude": parse_cat(row.get("Attitude", "0")),
                    "Human_Preparation": parse_cat(row.get("Preparation", "0")),
                    "Human_Curriculum": parse_cat(row.get("Curriculum", "0")),
                    "Human_Teaching": parse_cat(row.get("Teaching", "0")),
                }
            except ValueError as e:
                print(f"Skipping row for {tutor_id} due to parse error: {e}")
                continue
    return data

import json

def parse_json_report(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        scoring = data.get("scoring", {})
        final_score = float(scoring.get("final_weighted_score", 0.0))
        
        averages = scoring.get("averages", {})
        
        def get_cat_percent(cat_key):
            # Averages are usually 0-5. Convert to 0-100.
            val = averages.get(cat_key, 0.0)
            return (val / 5.0) * 100.0

        cat_scores = {
            "AI_Setup": get_cat_percent("setup"),
            "AI_Attitude": get_cat_percent("attitude"),
            "AI_Preparation": get_cat_percent("preparation"),
            "AI_Curriculum": get_cat_percent("curriculum"),
            "AI_Teaching": get_cat_percent("teaching"),
        }
        return final_score, cat_scores
    except Exception as e:
        print(f"Error parsing JSON {file_path}: {e}")
        return 0.0, {}

def main():
    if not os.path.exists(CSV_PATH):
        print(f"CSV not found: {CSV_PATH}")
        return

    human_data = parse_csv(CSV_PATH)
    print(f"Loaded {len(human_data)} human records.")
    
    # Search for JSON reports in Sessions folder recursively
    report_files = glob.glob(os.path.join(SESSIONS_ROOT, "**", "*Quality_Report_RAG*.json"), recursive=True)
    
    # Also include the Repots folder for backward compatibility
    report_files += glob.glob(os.path.join("Repots", "*.json")) # In case json exists there
    
    # Filter duplicates if any
    report_files = list(set(report_files))
    
    print(f"Found {len(report_files)} AI reports.")
    
    print("-" * 100)
    print(f"{'Tutor ID':<10} | {'Final (Hu)':<10} {'Final (AI)':<10} {'Diff':<6} | {'Setup':<6} {'Att.':<6} {'Prep.':<6} {'Curr.':<6} {'Teach':<6}")
    print("-" * 100)
    
    diffs = []
    
    for report_path in sorted(report_files):
        filename = os.path.basename(report_path)
        # Extract T-XXXX
        tutor_id_match = re.search(r'(T-\d+)', filename)
        if not tutor_id_match:
            continue
        tutor_id = tutor_id_match.group(1)
        
        if tutor_id not in human_data:
            # print(f"{tutor_id:<10} | No Human Data found in CSV")
            continue
            
        ai_final, ai_cats = parse_json_report(report_path)
        human = human_data[tutor_id]
        
        diff = ai_final - human["Human_Final"]
        diffs.append(abs(diff))
        
        # Calculate per-category diff strings
        def fmt_diff(cat):
            h = human[f"Human_{cat}"]
            a = ai_cats.get(f"AI_{cat}", 0)
            return f"{h:.0f}/{a:.0f}"
            
        print(f"{tutor_id:<10} | {human['Human_Final']:<10} {ai_final:<10} {diff:<+6.1f} | " +
              f"{fmt_diff('Setup'):<6} {fmt_diff('Attitude'):<6} {fmt_diff('Preparation'):<6} {fmt_diff('Curriculum'):<6} {fmt_diff('Teaching'):<6}")

    if diffs:
        print("-" * 100)
        print(f"Mean Absolute Error (Final Score): {statistics.mean(diffs):.2f}")
        print(f"Max Error: {max(diffs):.2f}")

if __name__ == "__main__":
    main()
