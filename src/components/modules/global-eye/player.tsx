import { ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";

/** 加载失败自动重新取地址的次数(平台偶发 m3u8 404 / 空地址) */
const MAX_RETRY = 2;

type PlayerError = { message: string; mixedContent?: boolean };

/**
 * HLS 播放器:原生支持 HLS 的浏览器(Safari/iOS)直接播,其余用 hls.js(动态加载)。
 * 失败时(媒体节点偶发 404、地址过期等)会**自动重新取一次地址**再试,超过次数才显示「重试」。
 * HTTPS 页面 + http 媒体(混合内容)时,额外提供「新标签打开」。
 */
export function GlobalEyePlayer({
	url,
	httpPlayerUrl,
	onRetry,
}: {
	url: string;
	/** 可选的**外部 http 播放页**(HTTPS 部署时用它在新标签播放,如 http://host/player.html) */
	httpPlayerUrl?: string | null;
	onRetry?: () => void;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [error, setError] = useState<PlayerError | null>(null);
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
		setError(null);

		// HTTPS 页面无法加载 http 媒体(混合内容;媒体服务器若不支持 https 则无解)
		if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
			setError({
				message: "HTTPS 页面无法播放 http:// 视频流(混合内容)。需平台提供 https 地址,或用浏览器策略放行。",
				mixedContent: true,
			});
			return;
		}

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
				setError({ message: "视频加载失败" });
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
				setError({ message: "当前浏览器不支持 HLS 播放" });
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
		setError(null);
		setReloadKey((key) => key + 1);
		onRetryRef.current?.();
	}

	function openInNewTab() {
		// 配了 http 播放页 ⇒ 打开「页面?url=…」(该页面是 http,才能在 https 部署下播 http 流);
		// 否则只能打开原始地址(Chrome 里 .m3u8 会变成文件下载)。
		const target = httpPlayerUrl
			? `${httpPlayerUrl}${httpPlayerUrl.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`
			: url;
		window.open(target, "_blank", "noopener,noreferrer");
	}

	return (
		<div className="relative h-full w-full">
			<video ref={videoRef} className="h-full w-full object-contain" controls autoPlay muted playsInline />
			{error ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-4 text-center text-sm text-white">
					<p className="max-w-md">{error.message}</p>
					<div className="flex items-center gap-2">
						{error.mixedContent ? (
							<Button size="sm" onClick={openInNewTab}>
								<ExternalLink className="size-3.5" />
								新标签打开
							</Button>
						) : null}
						<Button size="sm" variant="secondary" onClick={manualRetry}>
							<RotateCw className="size-3.5" />
							重试
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
