from flask import Flask, request, Response,render_template
import subprocess

app = Flask(__name__)

BLOCKED = [
    ";",
    "|",
    "\n",
    "\r",
]

def sanitize(value: str):
    original = value
    for token in BLOCKED:
        value = value.replace(token, "")
    return value, value != original

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/lookup', methods=['POST'])
def lookup():
    domain = request.form.get('domain', '').strip()
    if not domain:
        return render_template(
            "result.html",
            domain="",
            output="No hostname provided.",
            sanitized=False
        ), 400
    domain, sanitized = sanitize(domain)

    command = f"getent hosts {domain}"
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if not output:
                output = "No results found for this domain."
        else:
            output = "Error: Invalid hostname or lookup failed."


    except subprocess.TimeoutExpired:
        output = "Command timed out"
    return render_template(
        "result.html",
        domain=domain,
        output=output,
        sanitized=sanitized
    )

@app.route("/robots.txt")
def robots():
    return Response("Some thing is forgotten which can help you to bypass =))", mimetype="text/plain")

@app.route("/health")
def health():
    return Response("OK", mimetype="text/plain")
