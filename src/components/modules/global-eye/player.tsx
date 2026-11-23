import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";

/** 加载失败自动重新取地址的次数(平台偶发 m3u8 404 / 空地址) */
const MAX_RETRY = 2;

/**
 * HLS 播放器:原生支持 HLS 的浏览器(Safari/iOS)直接播,其余用 hls.js(动态加载)。
 * 失败时(平台媒体节点偶发 404、地址过期等)会**自动重新取一次地址**再试,超过次数才显示「重试」。
 */
export function GlobalEyePlayer({ url, onRetry }: { url: string; onRetry?: () => void }) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [failed, setFailed] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const attemptsRef = useRef(0);
	const prevUrlRef = useRef(url);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onRetryRef = useRef(onRetry);
	onRetryRef.current = onRetry;

	// 拿到新地址(重新取流成功)⇒ 重置自动重试计数
	useEffect(() => {
		if (prevUrlRef.current !== url) {
			prevUrlRef.current = url;
			attemptsRef.current = 0;
		}
	}, [url]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` 是刻意的重建触发器
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !url) return;
		setFailed(false);
		let destroyed = false;
		let destroy: (() => void) | undefined;

		const fail = () => {
			if (attemptsRef.current < MAX_RETRY) {
				attemptsRef.current += 1;
				timerRef.current = setTimeout(() => {
					setReloadKey((key) => key + 1);
					onRetryRef.current?.();
				}, 1200);
			} else {
				setFailed(true);
			}
		};

		if (video.canPlayType("application/vnd.apple.mpegurl")) {
			const onError = () => fail();
			video.addEventListener("error", onError);
			video.src = url;
			void video.play().catch(() => {});
			return () => {
				video.removeEventListener("error", onError);
				video.removeAttribute("src");
				video.load();
			};
		}

		void (async () => {
			const { default: Hls } = await import("hls.js");
			if (destroyed) return;
			if (!Hls.isSupported()) {
				setFailed(true);
				return;
			}
			const hls = new Hls();
			hls.loadSource(url);
			hls.attachMedia(video);
			hls.on(Hls.Events.ERROR, (_event, data) => {
				if (data.fatal) fail();
			});
			void video.play().catch(() => {});
			destroy = () => hls.destroy();
		})();

		return () => {
			destroyed = true;
			destroy?.();
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [url, reloadKey]);

	function manualRetry() {
		attemptsRef.current = 0;
		setFailed(false);
		setReloadKey((key) => key + 1);
		onRetryRef.current?.();
	}

	return (
		<div className="relative h-full w-full">
			<video ref={videoRef} className="h-full w-full object-contain" controls autoPlay muted playsInline />
			{failed ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-sm text-white">
					<p>视频加载失败</p>
					<Button size="sm" variant="secondary" onClick={manualRetry}>
						<RotateCw className="size-3.5" />
						重试
					</Button>
				</div>
			) : null}
		</div>
	);
}
