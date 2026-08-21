import os
from flask import Flask, render_template, request, abort

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NOTES_DIR = os.path.join(BASE_DIR, 'notes')

def create_flag():
    flag = os.environ.get('FLAG', 'KCSC{default_flag}')
    try:
        with open("/flag.txt", "w") as f:
            f.write(flag)
    except PermissionError:
        pass

create_flag()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/notes')
def read_note():
    filename = request.args.get("file")
    if not filename:
        abort(400, "File parameter is required.")

    filepath = os.path.join(NOTES_DIR, filename)

    try:
        with open(filepath, 'r') as f:
            content = f.read()
        return render_template('note.html', filename=filename, content=content)
    except FileNotFoundError:
        abort(404, "File not found.")
    except IsADirectoryError:
        abort(400, "Invalid file path.")
    except PermissionError:
        abort(403, "Permission denied.")

@app.route('/health')
def health():
    return "Service is running."

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)