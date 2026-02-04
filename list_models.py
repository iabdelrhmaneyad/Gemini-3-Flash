import google.generativeai as genai
import os

API_KEY = "AIzaSyAWg-0-zCBT9Aj6-jIU-W4SWCTQ3D2UKMA"
genai.configure(api_key=API_KEY)

for m in genai.list_models():
    if 'generateContent' in m.supported_generation_methods:
        print(m.name)