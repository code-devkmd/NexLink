const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
let selectedFile = null;
let toastTimer;
const maxSize = 100 * 1024 * 1024;

function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function showToast(message) {
	const toast = $("toast");
	toast.textContent = message;
	toast.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function notice(message = "", type = "") {
	$("notice").textContent = message;
	$("notice").className = `notice ${type}`;
}
function chooseFile(file) {
	if (!file) return;
	if (file.size > maxSize) {
		notice("This file is larger than the 100 MB limit.", "error");
		return;
	}
	selectedFile = file;
	$("fileName").textContent = file.name;
	$("fileSize").textContent = formatSize(file.size);
	$("fileType").textContent = (file.name.split(".").pop() || "FILE")
		.slice(0, 4)
		.toUpperCase();
	$("selectedFile").classList.remove("hidden");
	dropzone.classList.add("hidden");
	$("sendBtn").disabled = !$("uploadKey").value.trim();
	notice("");
}
function clearFile() {
	selectedFile = null;
	fileInput.value = "";
	$("selectedFile").classList.add("hidden");
	dropzone.classList.remove("hidden");
	$("sendBtn").disabled = true;
	notice("");
}
dropzone.addEventListener("click", (e) => {
	if (e.target.closest("button")) return;
	fileInput.click();
});
dropzone.addEventListener("keydown", (e) => {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		fileInput.click();
	}
});
$("browseBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => chooseFile(fileInput.files[0]));
$("removeFile").addEventListener("click", clearFile);
$("uploadKey").addEventListener("input", () => {
	$("sendBtn").disabled = !selectedFile || !$("uploadKey").value.trim();
});
$("toggleKey").addEventListener("click", () => {
	const input = $("uploadKey");
	input.type = input.type === "password" ? "text" : "password";
	$("toggleKey").textContent = input.type === "password" ? "Show" : "Hide";
});
["dragenter", "dragover"].forEach((type) =>
	dropzone.addEventListener(type, (e) => {
		e.preventDefault();
		dropzone.classList.add("dragover");
	}),
);
["dragleave", "drop"].forEach((type) =>
	dropzone.addEventListener(type, (e) => {
		e.preventDefault();
		dropzone.classList.remove("dragover");
	}),
);
dropzone.addEventListener("drop", (e) => chooseFile(e.dataTransfer.files[0]));

function upload(file, key) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/transfers");
		xhr.setRequestHeader("x-upload-key", key);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) {
				const p = Math.round((e.loaded / e.total) * 100);
				$("progressBar").style.width = `${p}%`;
				$("progressPercent").textContent = `${p}%`;
				$("progressLabel").textContent =
					p === 100 ? "Processing file…" : "Uploading…";
			}
		};
		xhr.onload = () => {
			let data;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				return reject(new Error("Unexpected server response."));
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(data);
			else reject(new Error(data.error || "Upload failed."));
		};
		xhr.onerror = () =>
			reject(new Error("Network error. Check your connection and try again."));
		const form = new FormData();
		form.append("file", file);
		xhr.send(form);
	});
}
$("sendBtn").addEventListener("click", async () => {
	if (!selectedFile || !$("uploadKey").value.trim()) return;
	const button = $("sendBtn");
	button.disabled = true;
	$("uploadProgress").classList.remove("hidden");
	$("progressBar").style.width = "0%";
	$("progressPercent").textContent = "0%";
	notice("");
	try {
		const result = await upload(selectedFile, $("uploadKey").value.trim());
		$("progressBar").style.width = "100%";
		$("progressPercent").textContent = "100%";
		$("progressLabel").textContent = "Added to your queue";
		notice(
			`${result.name} is safely queued for your Ubuntu computer.`,
			"success",
		);
		showToast("File added to your transfer queue");
		clearFile();
		await loadDashboard();
	} catch (error) {
		notice(error.message, "error");
		showToast(error.message);
	} finally {
		button.disabled = !selectedFile || !$("uploadKey").value.trim();
		setTimeout(() => $("uploadProgress").classList.add("hidden"), 1800);
	}
});

function timeAgo(value) {
	const diff = Math.max(0, Date.now() - new Date(value).getTime());
	if (diff < 60000) return "Just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
	return new Date(value).toLocaleDateString();
}
function renderTransfers(items) {
	const list = $("transferList");
	if (!items.length) {
		list.innerHTML =
			'<div class="empty-state"><div class="empty-symbol">⇄</div><strong>No transfers yet</strong><span>Your sent files will appear here.</span></div>';
		return;
	}
	list.innerHTML = items
		.map((item) => {
			const status = item.status || "pending";
			const label =
				status === "pending"
					? "Waiting"
					: status === "downloading"
						? "Receiving"
						: status[0].toUpperCase() + status.slice(1);
			const ext = (item.name.split(".").pop() || "FILE")
				.slice(0, 4)
				.toUpperCase();
			return `<div class="transfer-row"><div class="transfer-file-icon">${escapeHtml(ext)}</div><div class="transfer-info"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${formatSize(item.size)} · ${timeAgo(item.createdAt)}</small></div><span class="status-tag ${status}">${label}</span></div>`;
		})
		.join("");
}
function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
}
async function loadDashboard() {
	const key = $("uploadKey").value.trim();
	if (!key) return;
	try {
		const response = await fetch("/api/dashboard", {
			headers: { "x-upload-key": key },
		});
		if (!response.ok) {
			if (response.status === 401)
				notice("Your upload key is not valid.", "error");
			return;
		}
		const data = await response.json();
		renderTransfers(data.transfers);
		$("deviceDot").classList.toggle("online", data.receiverOnline);
		$("deviceStatus").textContent = data.receiverOnline
			? "Receiver is online"
			: "Waiting for receiver";
		$("deviceSubstatus").textContent = data.receiverOnline
			? "Your Ubuntu computer checked in recently"
			: "Files queue safely while it is offline";
	} catch {
		/* dashboard refresh is best-effort */
	}
}
$("refreshBtn").addEventListener("click", loadDashboard);
$("refreshText").addEventListener("click", loadDashboard);
setInterval(loadDashboard, 20000);
