import { useEffect, useRef, useState } from "react";

/**
 * HLS 播放器 —— 用 `hls.js`(动态 import,不进首屏包)。
 *
 * - Safari 等原生支持 HLS 的浏览器直接 `<video src>`;
 * - 其余(Chrome / Edge / Firefox)走 `hls.js`;
 * - 卸载或 `url` 变化时销毁实例;致命错误给一句中文提示。
 *
 * 取流地址由服务端(带 token)取好后下发,浏览器只负责播放。
 */
export function HlsPlayer({ url }: { url: string }) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !url) return;
		setError(null);

		// 原生 HLS(主要是 Safari / iOS)
		if (video.canPlayType("application/vnd.apple.mpegurl")) {
			video.src = url;
			return () => {
				video.removeAttribute("src");
				video.load();
			};
		}

		let cancelled = false;
		let destroy: (() => void) | undefined;
		void (async () => {
			try {
				const { default: Hls } = await import("hls.js");
				if (cancelled) return;
				if (!Hls.isSupported()) {
					setError("当前浏览器不支持 HLS 播放");
					return;
				}
				const hls = new Hls({ enableWorker: true });
				hls.loadSource(url);
				hls.attachMedia(video);
				hls.on(Hls.Events.ERROR, (_event, data) => {
					if (data.fatal) setError("视频加载失败:请确认平台通道可正常取流");
				});
				destroy = () => hls.destroy();
			} catch {
				if (!cancelled) setError("播放器初始化失败");
			}
		})();

		return () => {
			cancelled = true;
			destroy?.();
		};
	}, [url]);

	return (
		<div className="relative h-full w-full">
			<video ref={videoRef} className="h-full w-full object-contain" controls autoPlay muted playsInline />
			{error ? (
				<div className="absolute inset-0 grid place-items-center bg-black/70 px-4 text-center text-sm text-white">
					{error}
				</div>
			) : null}
		</div>
	);
}
