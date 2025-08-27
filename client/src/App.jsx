import { useEffect, useRef, useState } from 'react';

const API_BASE = 'http://127.0.0.1:8000';

export default function App() {
	const [url, setUrl] = useState('');
	const [info, setInfo] = useState(null);
	const [chosenFmt, setChosenFmt] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const [jobId, setJobId] = useState('');
	const [job, setJob] = useState(null);
	const pollRef = useRef(null);

	const fetchInfo = async () => {
		setError('');
		setInfo(null);
		setChosenFmt('');
		setJobId('');
		setJob(null);
		if (!url) return;
		setLoading(true);
		try {
			const res = await fetch(`${API_BASE}/info?url=${encodeURIComponent(url)}`);
			if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
			const data = await res.json();
			setInfo(data);
		} catch (e) {
			setError(e.message || 'Failed to fetch info');
		} finally {
			setLoading(false);
		}
	};

	const startDownload = async () => {
		if (!info || !chosenFmt) return;
		setError('');
		setJobId('');
		setJob(null);
		try {
			const res = await fetch(`${API_BASE}/start_download`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url, format_id: chosenFmt }),
			});
			if (!res.ok) throw new Error((await res.json()).detail || 'Failed to start');
			const { job_id } = await res.json();
			setJobId(job_id);
		} catch (e) {
			setError(e.message || 'Failed to start download');
		}
	};

	useEffect(() => {
		if (!jobId) return;
		pollRef.current = setInterval(async () => {
			try {
				const res = await fetch(`${API_BASE}/progress?job_id=${encodeURIComponent(jobId)}`);
				if (!res.ok) return;
				const j = await res.json();
				setJob(j);
				if (j.status === 'finished' || j.status === 'error') {
					clearInterval(pollRef.current);
					pollRef.current = null;
				}
			} catch {}
		}, 700);
		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [jobId]);

	const downloadFile = async () => {
		if (!jobId) return;
		try {
			const res = await fetch(`${API_BASE}/download_file?job_id=${encodeURIComponent(jobId)}`);
			if (!res.ok) throw new Error((await res.json()).detail || 'Not ready');
			const blob = await res.blob();
			const a = document.createElement('a');
			const objUrl = URL.createObjectURL(blob);
			a.href = objUrl;
			const base = (job?.title || info?.title || 'video').replace(/[\\/:*?"<>|]+/g, '_');
			a.download = `${base}.mp4`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objUrl);
		} catch (e) {
			setError(e.message || 'Download failed');
		}
	};

	const pct = Math.round(((job?.progress || 0) * 100));

	return (
		<div style={{ maxWidth: 900, margin: '2rem auto', padding: '1rem' }}>
			<h2>YouTube Downloader</h2>
			<div style={{ display: 'flex', gap: 8 }}>
				<input
					style={{ flex: 1, padding: 8 }}
					placeholder="Paste YouTube URL"
					value={url}
					onChange={e => setUrl(e.target.value)}
				/>
				<button onClick={fetchInfo} disabled={loading || !url}>
					{loading ? 'Loading...' : 'Get Info'}
				</button>
			</div>

			{error && <p style={{ color: 'red', marginTop: 12 }}>{String(error)}</p>}

			{info && (
				<div style={{ marginTop: 16, border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
					<div style={{ display: 'flex', gap: 12 }}>
						{info.thumbnail && <img src={info.thumbnail} alt="" width={160} />}
						<div>
							<h3 style={{ margin: 0 }}>{info.title}</h3>
							<p style={{ margin: '4px 0' }}>{info.uploader}</p>
							<p style={{ margin: '4px 0' }}>
								Duration: {info.duration ? `${Math.floor(info.duration / 60)}m ${info.duration % 60}s` : 'N/A'}
							</p>
							<div style={{ marginTop: 8 }}>
								<label>Choose format: </label>
								<select value={chosenFmt} onChange={e => setChosenFmt(e.target.value)}>
									<option value="" disabled>Pick a format</option>
									{(info.formats || [])
										.filter(f => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
										.slice()
										.sort((a, b) => {
											const ha = a.resolution?.match(/(\d+)p/);
											const hb = b.resolution?.match(/(\d+)p/);
											const va = ha ? parseInt(ha[1], 10) : 0;
											const vb = hb ? parseInt(hb[1], 10) : 0;
											return vb - va;
										})
										.map(f => (
											<option key={f.format_id} value={f.format_id}>
												{`${f.resolution || 'N/A'} • ${f.ext}${f.filesize ? ` • ${(f.filesize / (1024*1024)).toFixed(1)} MB` : ''}`}
											</option>
										))}
								</select>
							</div>

							{!jobId && (
								<div style={{ marginTop: 12 }}>
									<button onClick={startDownload} disabled={!chosenFmt}>
										Start Download
									</button>
								</div>
							)}

							{jobId && (
								<div style={{ marginTop: 12, width: 380 }}>
									<div style={{ height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
										<div style={{ height: '100%', width: `${pct}%`, background: '#4caf50', transition: 'width 0.3s' }} />
									</div>
									<div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
										{job?.status === 'downloading' && (
											<>
												<span>{pct}%</span>
												{job?.speed && <span> • {(job.speed / (1024*1024)).toFixed(2)} MB/s</span>}
												{job?.eta && <span> • ETA {job.eta}s</span>}
											</>
										)}
										{job?.status === 'queued' && <span>Queued…</span>}
										{job?.status === 'finished' && <span>Finished.</span>}
										{job?.status === 'error' && <span style={{ color: 'red' }}>Error: {job.error}</span>}
									</div>

									<div style={{ marginTop: 10 }}>
										<button onClick={downloadFile} disabled={job?.status !== 'finished'}>
											{job?.status === 'finished' ? 'Download File' : 'Preparing…'}
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}