import { useEffect, useState } from 'react';

const API_BASE = 'http://127.0.0.1:8000';

export default function App() {
	const [url, setUrl] = useState('');
	const [videos, setVideos] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const isValidYouTubeUrl = (url) => {
		const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
		return youtubeRegex.test(url);
	};

	const fetchInfo = async () => {
		setError('');
		if (!url) return;
		
		if (!isValidYouTubeUrl(url)) {
			setError('Please enter a valid YouTube URL (youtube.com or youtu.be)');
			return;
		}
		
		setLoading(true);
		try {
			const res = await fetch(`${API_BASE}/info?url=${encodeURIComponent(url)}`);
			if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
			const data = await res.json();
			
			const existingIndex = videos.findIndex(v => v.id === data.id);
			if (existingIndex >= 0) {
				setError('This video is already in the list');
				return;
			}
			
			setVideos(prev => [...prev, { ...data, url: url, chosenFmt: '', jobId: '', job: null }]);
			setUrl('');
		} catch (e) {
			setError(e.message || 'Failed to fetch info');
		} finally {
			setLoading(false);
		}
	};

	const updateVideo = (videoId, updates) => {
		setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...updates } : v));
	};

	const removeVideo = (videoId) => {
		setVideos(prev => prev.filter(v => v.id !== videoId));
	};

	const startDownload = async (video) => {
		if (!video.chosenFmt) return;
		setError('');
		try {
			const res = await fetch(`${API_BASE}/start_download`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: video.url, format_id: video.chosenFmt }),
			});
			if (!res.ok) throw new Error((await res.json()).detail || 'Failed to start');
			const { job_id } = await res.json();
			updateVideo(video.id, { jobId: job_id });
		} catch (e) {
			setError(e.message || 'Failed to start download');
		}
	};

	const downloadFile = async (video) => {
		if (!video.jobId) return;
		try {
			const res = await fetch(`${API_BASE}/download_file?job_id=${encodeURIComponent(video.jobId)}`);
			if (!res.ok) throw new Error((await res.json()).detail || 'Not ready');
			const blob = await res.blob();
			const a = document.createElement('a');
			const objUrl = URL.createObjectURL(blob);
			a.href = objUrl;
			const base = (video.job?.title || video.title || 'video').replace(/[\\/:*?"<>|]+/g, '_');
			a.download = `${base}.mp4`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objUrl);
		} catch (e) {
			setError(e.message || 'Download failed');
		}
	};

	// Poll progress for all videos with active jobs
	useEffect(() => {
		const activeJobs = videos.filter(v => v.jobId && v.job?.status !== 'finished' && v.job?.status !== 'error');
		if (activeJobs.length === 0) return;

		const pollRef = setInterval(async () => {
			for (const video of activeJobs) {
				try {
					const res = await fetch(`${API_BASE}/progress?job_id=${encodeURIComponent(video.jobId)}`);
					if (!res.ok) continue;
					const job = await res.json();
					updateVideo(video.id, { job });
				} catch (e) {
					console.error('Error polling progress:', e);
				}
			}
		}, 700);

		return () => clearInterval(pollRef);
	}, [videos]);

	return (
		<div style={{ maxWidth: 900, margin: '2rem auto', padding: '1rem' }}>
			<h2>YouTube Downloader</h2>
			<div style={{ display: 'flex', gap: 8 }}>
				<input
					style={{ flex: 1, padding: 8 }}
					placeholder="Paste YouTube URL"
					value={url}
					onChange={e => setUrl(e.target.value)}
					onKeyPress={e => e.key === 'Enter' && fetchInfo()}
				/>
				<button onClick={fetchInfo} disabled={loading || !url}>
					{loading ? 'Loading...' : 'Add Video'}
				</button>
			</div>

			{error && <p style={{ color: 'red', marginTop: 12 }}>{String(error)}</p>}

			{videos.length === 0 && (
				<div style={{ marginTop: 32, textAlign: 'center', color: '#666' }}>
					<p>No videos added yet. Paste a YouTube URL above to get started!</p>
				</div>
			)}

			{videos.map((video) => {
				const pct = Math.round(((video.job?.progress || 0) * 100));
				
				return (
					<div key={video.id} style={{ 
						marginTop: 16, 
						border: '1px solid #ddd', 
						padding: 12, 
						borderRadius: 8,
						position: 'relative'
					}}>
						<button 
							onClick={() => removeVideo(video.id)}
							style={{
								position: 'absolute',
								top: 8,
								right: 8,
								background: 'transparent',
								color: '#999',
								border: 'none',
								width: 24,
								height: 24,
								cursor: 'pointer',
								fontSize: 16
							}}
						>
							×
						</button>
						
						<div style={{ display: 'flex', gap: 12 }}>
							{video.thumbnail && <img src={video.thumbnail} alt="" width={160} />}
							<div style={{ flex: 1 }}>
								<h3 style={{ margin: 0, paddingRight: 32 }}>{video.title}</h3>
								<p style={{ margin: '4px 0' }}>{video.uploader}</p>
								<p style={{ margin: '4px 0' }}>
									Duration: {video.duration ? `${Math.floor(video.duration / 60)}m ${video.duration % 60}s` : 'N/A'}
								</p>
								
								{!video.jobId && (
									<div style={{ marginTop: 8 }}>
										<label>Choose format: </label>
										<select 
											value={video.chosenFmt} 
											onChange={e => updateVideo(video.id, { chosenFmt: e.target.value })}
										>
											<option value="" disabled>Pick a format</option>
											{(video.formats || [])
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
								)}

								{!video.jobId && (
									<div style={{ marginTop: 12 }}>
										<button onClick={() => startDownload(video)} disabled={!video.chosenFmt}>
											Start Download
										</button>
									</div>
								)}

								{video.jobId && (
									<div style={{ marginTop: 12, width: 380 }}>
										<div style={{ height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
											<div style={{ height: '100%', width: `${pct}%`, background: '#4caf50', transition: 'width 0.3s' }} />
										</div>
										<div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
											{video.job?.status === 'downloading' && (
												<>
													<span>{pct}%</span>
													{video.job?.speed && <span> • {(video.job.speed / (1024*1024)).toFixed(2)} MB/s</span>}
													{video.job?.eta && <span> • ETA {video.job.eta}s</span>}
												</>
											)}
											{video.job?.status === 'queued' && <span>Queued…</span>}
											{video.job?.status === 'finished' && <span>Finished.</span>}
											{video.job?.status === 'error' && <span style={{ color: 'red' }}>Error: {video.job.error}</span>}
										</div>

										<div style={{ marginTop: 10 }}>
											<button onClick={() => downloadFile(video)} disabled={video.job?.status !== 'finished'}>
												{video.job?.status === 'finished' ? 'Download File' : 'Preparing…'}
											</button>
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}