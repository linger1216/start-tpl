/**
 * 文件预览判据(`src/lib/file-preview.ts`)—— 纯函数单测,**不连库**。
 *
 * 为什么要测:分流结果直接决定"点详情会不会去拉字节",判错的代价是要么该预览的看不到、
 * 要么把一个二进制文件当文本塞进 `<pre>`。判据同时看 MIME 与后缀,组合不少,靠手点测不全。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { filePreviewKind } from "../src/lib/file-preview.ts";

test("图片:按 MIME 的 image/ 前缀认(后缀不参与)", () => {
	assert.equal(filePreviewKind({ contentType: "image/png", ext: "png" }), "image");
	assert.equal(filePreviewKind({ contentType: "image/svg+xml", ext: null }), "image");
	// MIME 大写 / 带空格也要认(上传时是客户端自己报的)
	assert.equal(filePreviewKind({ contentType: " Image/JPEG ", ext: null }), "image");
});

test("PDF:MIME 或后缀命中任一即可", () => {
	assert.equal(filePreviewKind({ contentType: "application/pdf", ext: "pdf" }), "pdf");
	// 浏览器直传时报成 octet-stream 是常态 —— 靠后缀兜住
	assert.equal(filePreviewKind({ contentType: "application/octet-stream", ext: "pdf" }), "pdf");
	assert.equal(filePreviewKind({ contentType: null, ext: "PDF" }), "pdf");
	assert.equal(filePreviewKind({ contentType: null, ext: ".pdf" }), "pdf");
});

test("文本:text/* 、不在 text/ 下的文本型 MIME、以及认后缀三种任一生效", () => {
	assert.equal(filePreviewKind({ contentType: "text/plain", ext: "txt" }), "text");
	assert.equal(filePreviewKind({ contentType: "text/csv", ext: null }), "text");
	assert.equal(filePreviewKind({ contentType: "application/json", ext: "json" }), "text");
	assert.equal(filePreviewKind({ contentType: "application/octet-stream", ext: "log" }), "text");
	assert.equal(filePreviewKind({ contentType: null, ext: "sql" }), "text");
	assert.equal(filePreviewKind({ contentType: null, ext: "ts" }), "text");
});

test("其余一律 none:宁可少预览,也不把二进制当文本", () => {
	assert.equal(filePreviewKind({ contentType: "application/zip", ext: "zip" }), "none");
	assert.equal(filePreviewKind({ contentType: "application/vnd.ms-excel", ext: "xlsx" }), "none");
	assert.equal(filePreviewKind({ contentType: "application/msword", ext: "docx" }), "none");
	assert.equal(filePreviewKind({ contentType: "video/mp4", ext: "mp4" }), "none");
	assert.equal(filePreviewKind({ contentType: null, ext: null }), "none");
});
