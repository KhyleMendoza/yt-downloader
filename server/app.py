import os
import tempfile
import threading
import uuid
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from yt_dlp import YoutubeDL

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}})

_jobs = {}
_jobs_lock = threading.Lock()

def _new_job():
	job_id = str(uuid.uuid4())
	with _jobs_lock:
		_jobs[job_id] = {
			"status": "queued",
			"progress": 0.0,
			"downloaded_bytes": 0,
			"total_bytes": None,
			"speed": None,
			"eta": None,
			"filepath": None,
			"filename": None,
			"error": None,
			"title": None,
		}
	return job_id

@app.get("/info")
def info():
	url = request.args.get("url")
	if not url:
		return jsonify({"detail": "Missing 'url' parameter"}), 400
	try:
		with YoutubeDL({"quiet": True, "skip_download": True}) as ydl:
			data = ydl.extract_info(url, download=False)
		fmts = []
		for f in data.get("formats", []):
			if not f.get("format_id"):
				continue
			resolution = f.get("resolution") or (f.get("height") and f"{f['height']}p")
			fmts.append({
				"format_id": str(f.get("format_id")),
				"ext": f.get("ext"),
				"resolution": resolution,
				"filesize": f.get("filesize") or f.get("filesize_approx"),
				"vcodec": f.get("vcodec"),
				"acodec": f.get("acodec"),
			})
		return jsonify({
			"id": data.get("id"),
			"title": data.get("title"),
			"thumbnail": (data.get("thumbnail") or (data.get("thumbnails") or [{}])[-1].get("url") if data.get("thumbnails") else None),
			"duration": data.get("duration"),
			"uploader": data.get("uploader"),
			"formats": fmts,
		})
	except Exception as e:
		return jsonify({"detail": str(e)}), 400

def _run_download(job_id: str, url: str, format_id: str):
	tmpdir = tempfile.mkdtemp(prefix="yt_")
	outtmpl = os.path.join(tmpdir, "%(title)s.%(ext)s")

	def hook(d):
		with _jobs_lock:
			job = _jobs.get(job_id)
			if not job:
				return
			if d["status"] == "downloading":
				job["status"] = "downloading"
				job["downloaded_bytes"] = d.get("downloaded_bytes") or d.get("downloaded_bytes_estimate") or 0
				job["total_bytes"] = d.get("total_bytes") or d.get("total_bytes_estimate")
				job["speed"] = d.get("speed")
				job["eta"] = d.get("eta")
				if job["total_bytes"]:
					job["progress"] = min(1.0, job["downloaded_bytes"] / job["total_bytes"])
			elif d["status"] == "finished":
				job["progress"] = 1.0

	ydl_opts = {
		"format": format_id,
		"outtmpl": outtmpl,
		"noplaylist": True,
		"merge_output_format": "mp4",
		"progress_hooks": [hook],
		"quiet": True,
	}

	try:
		with YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(url, download=True)
			filepath = info.get("_filename") or ydl.prepare_filename(info)
		filename = os.path.basename(filepath)
		with _jobs_lock:
			job = _jobs.get(job_id)
			if job is not None:
				job["status"] = "finished"
				job["filepath"] = filepath
				job["filename"] = filename
				job["title"] = info.get("title")
	except Exception as e:
		with _jobs_lock:
			job = _jobs.get(job_id)
			if job is not None:
				job["status"] = "error"
				job["error"] = str(e)

@app.post("/start_download")
def start_download():
	data = request.get_json(silent=True) or {}
	url = data.get("url")
	format_id = data.get("format_id")
	if not url or not format_id:
		return jsonify({"detail": "Missing 'url' or 'format_id'"}), 400

	job_id = _new_job()
	t = threading.Thread(target=_run_download, args=(job_id, url, format_id), daemon=True)
	t.start()
	return jsonify({"job_id": job_id})

@app.get("/progress")
def progress():
	job_id = request.args.get("job_id")
	if not job_id:
		return jsonify({"detail": "Missing 'job_id'"}), 400
	with _jobs_lock:
		job = _jobs.get(job_id)
		if not job:
			return jsonify({"detail": "Job not found"}), 404
		return jsonify(job)

@app.get("/download_file")
def download_file():
	job_id = request.args.get("job_id")
	if not job_id:
		return jsonify({"detail": "Missing 'job_id'"}), 400
	with _jobs_lock:
		job = _jobs.get(job_id)
		if not job:
			return jsonify({"detail": "Job not found"}), 404
		if job["status"] != "finished" or not job.get("filepath"):
			return jsonify({"detail": "Not ready"}), 400
		filepath = job["filepath"]
		filename = job["filename"] or os.path.basename(filepath)

	return send_file(filepath, as_attachment=True, download_name=filename, mimetype="application/octet-stream")

if __name__ == "__main__":
	app.run(host="127.0.0.1", port=8000, debug=True)