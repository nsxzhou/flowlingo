import json
import ssl
import time
import urllib.request

url = "https://gyapi.zxiaoruan.cn/v1/chat/completions"
api_key = "sk-FoV0pMv24wl2f4Fqayhl10uplLyEzT0lpo6z4VIlwroMylPk"
model = "glm-4-flash"

headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

data = {
    "model": model,
    "messages": [
        {
            "role": "user",
            "content": "Hello, this is a test request. Please reply with 'OK'.",
        }
    ],
    "temperature": 0.2,
}

try:
    print(f"Sending request to {url} with model {model}...")
    req = urllib.request.Request(
        url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST"
    )

    context = ssl.create_default_context()

    with urllib.request.urlopen(req, context=context) as response:
        status_code = response.getcode()
        response_body = response.read().decode("utf-8")
        print(f"Status Code: {status_code}")
        print("Response Body:")
        print(response_body)

except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code} - {e.reason}")
    print("Error Body:")
    print(e.read().decode("utf-8"))
except urllib.error.URLError as e:
    print(f"URL Error: {e.reason}")
except Exception as e:
    print(f"An error occurred: {e}")
