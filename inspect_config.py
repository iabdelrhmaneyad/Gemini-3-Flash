
from google.genai import types

print("Actual Configuration Parameters:")
try:
    for name, field in types.GenerateContentConfig.model_fields.items():
        print(f"- {name}: {field.annotation}")
except Exception as e:
    print(f"Error checking model_fields: {e}")
