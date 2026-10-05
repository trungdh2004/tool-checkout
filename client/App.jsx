import { useEffect, useState } from "react";

const API_ROOT = "/tool-api";
const EMPTY_PROFILE = {
  loginName: "",
  password: "",
  imageFolder: "",
  scheduleTime: "17:40",
  enabled: false,
};

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, options);
  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Máy chủ trả về dữ liệu không hợp lệ.");
  }

  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Yêu cầu thất bại (${response.status}).`);
  }

  return result.data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function profilePayload(profile, password = "") {
  const payload = {
    loginName: profile.loginName,
    imageFolder: profile.imageFolder,
    scheduleTime: profile.scheduleTime,
    enabled: profile.enabled,
  };

  if (password) payload.password = password;
  return payload;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function fileLabel(image) {
  if (typeof image === "string") return image.split(/[\\/]/).pop() || image;
  return image.name || image.fileName || image.path?.split(/[\\/]/).pop() || "Ảnh";
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`notice notice--${notice.type}`} role="status">
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Đóng thông báo">
        ×
      </button>
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="toggle__track" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </label>
  );
}

export default function App() {
  const [settings, setSettings] = useState({ apiBaseUrl: "" });
  const [profiles, setProfiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [historyProfileId, setHistoryProfileId] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [togglingId, setTogglingId] = useState("");
  const [notice, setNotice] = useState(null);

  const selectedProfile = profiles.find(
    (profile) => String(profile.id) === String(selectedId),
  );
  const enabledCount = profiles.filter((profile) => profile.enabled).length;

  const reportError = (error) =>
    setNotice({ type: "error", message: error.message || "Đã có lỗi xảy ra." });

  async function loadHistory({
    profileId = historyProfileId,
    status = historyStatus,
    page = historyPage,
    pageSize = historyPageSize,
  } = {}) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (profileId) params.set("profileId", profileId);
    if (status) params.set("status", status);
    const result = await api(`/history?${params}`);
    setHistory(result?.items || []);
    setHistoryPage(result?.page || 1);
    setHistoryPageSize(result?.pageSize || pageSize);
    setHistoryTotal(result?.total || 0);
    setHistoryTotalPages(result?.totalPages || 1);
  }

  async function loadImages(profileId) {
    if (!profileId) {
      setImages([]);
      return;
    }
    setImages((await api(`/profiles/${encodeURIComponent(profileId)}/images`)) || []);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api("/settings"),
      api("/profiles"),
      api("/history?page=1&pageSize=20"),
    ])
      .then(([nextSettings, nextProfiles, nextHistory]) => {
        if (!active) return;
        setSettings(nextSettings || { apiBaseUrl: "" });
        setProfiles(nextProfiles || []);
        setHistory(nextHistory?.items || []);
        setHistoryPage(nextHistory?.page || 1);
        setHistoryPageSize(nextHistory?.pageSize || 20);
        setHistoryTotal(nextHistory?.total || 0);
        setHistoryTotalPages(nextHistory?.totalPages || 1);
        if (nextProfiles?.length) setSelectedId(nextProfiles[0].id);
      })
      .catch((error) => active && reportError(error))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setImages([]);
      return;
    }
    loadImages(selectedId).catch(reportError);
  }, [selectedId]);

  async function saveSettings(event) {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const saved = await api("/settings", jsonOptions("PUT", settings));
      setSettings(saved || settings);
      setNotice({ type: "success", message: "Đã lưu địa chỉ API." });
    } catch (error) {
      reportError(error);
    } finally {
      setSavingSettings(false);
    }
  }

  function beginCreate() {
    setEditingId(null);
    setProfileForm({ ...EMPTY_PROFILE });
    setShowForm(true);
  }

  function beginEdit(profile) {
    setEditingId(profile.id);
    setProfileForm({
      loginName: profile.loginName || "",
      password: "",
      imageFolder: profile.imageFolder || "",
      scheduleTime: profile.scheduleTime || "17:40",
      enabled: Boolean(profile.enabled),
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setProfileForm({ ...EMPTY_PROFILE });
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    const password = profileForm.password;
    const path = editingId ? `/profiles/${encodeURIComponent(editingId)}` : "/profiles";
    const method = editingId ? "PUT" : "POST";
    const previousProfile = profiles.find((profile) => profile.id === editingId);

    try {
      const saved = await api(
        path,
        jsonOptions(method, profilePayload(profileForm, password)),
      );
      setProfiles((current) =>
        editingId
          ? current.map((profile) => (profile.id === editingId ? saved : profile))
          : [saved, ...current],
      );
      setSelectedId(saved.id);
      closeForm();
      setNotice({
        type: "success",
        message: editingId && previousProfile?.scheduleTime !== saved.scheduleTime
          ? `Đã hủy lịch ${previousProfile.scheduleTime} và thay bằng ${saved.scheduleTime}.`
          : editingId ? "Đã cập nhật hồ sơ." : "Đã tạo hồ sơ.",
      });
    } catch (error) {
      setProfileForm((current) => ({ ...current, password: "" }));
      reportError(error);
    } finally {
      setSavingProfile(false);
    }
  }

  async function removeProfile(profile) {
    if (!window.confirm(`Xóa hồ sơ “${profile.fullName || profile.loginName}”?`)) return;
    try {
      await api(`/profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE" });
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (String(selectedId) === String(profile.id)) setSelectedId("");
      if (String(historyProfileId) === String(profile.id)) setHistoryProfileId("");
      setNotice({ type: "success", message: "Đã xóa hồ sơ." });
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleProfile(profile) {
    setTogglingId(profile.id);
    try {
      const saved = await api(
        `/profiles/${encodeURIComponent(profile.id)}`,
        jsonOptions("PUT", profilePayload({ ...profile, enabled: !profile.enabled })),
      );
      setProfiles((current) =>
        current.map((item) => (item.id === profile.id ? saved : item)),
      );
    } catch (error) {
      reportError(error);
    } finally {
      setTogglingId("");
    }
  }

  async function runProfile(profile) {
    const confirmed = window.confirm(
      `Chạy kiểm tra cho ${profile.fullName || profile.loginName}?\n\n` +
      "Tool chỉ tạo check khi hôm nay có đúng 1 mốc. Nếu đã có 2 mốc trở lên, tool sẽ bỏ qua.",
    );
    if (!confirmed) return;
    setRunningId(profile.id);
    try {
      const result = await api(`/profiles/${encodeURIComponent(profile.id)}/run`, { method: "POST" });
      setNotice({
        type: result.status === "failed" ? "error" : "success",
        message: result.status === "success"
          ? `Đã tạo check cho ${profile.fullName || profile.loginName}: ${result.message}`
          : `Không tạo check cho ${profile.fullName || profile.loginName}: ${result.message}`,
      });
       await loadHistory({ page: 1 });
    } catch (error) {
      reportError(error);
    } finally {
      setRunningId("");
    }
  }

  async function uploadImages(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.images;
    if (!input.files.length || !selectedId) return;
    const formData = new FormData();
    for (const file of input.files) formData.append("images", file);

    setUploading(true);
    try {
      await api(`/profiles/${encodeURIComponent(selectedId)}/images`, {
        method: "POST",
        body: formData,
      });
      input.value = "";
      await loadImages(selectedId);
      setNotice({ type: "success", message: "Đã tải ảnh lên." });
    } catch (error) {
      input.value = "";
      reportError(error);
    } finally {
      setUploading(false);
    }
  }

  async function filterHistory(profileId) {
    setHistoryProfileId(profileId);
    try {
      await loadHistory({ profileId, page: 1 });
    } catch (error) {
      reportError(error);
    }
  }

  async function filterHistoryStatus(status) {
    setHistoryStatus(status);
    try {
      await loadHistory({ status, page: 1 });
    } catch (error) {
      reportError(error);
    }
  }

  async function changeHistoryPage(page) {
    try {
      await loadHistory({ page });
    } catch (error) {
      reportError(error);
    }
  }

  async function changeHistoryPageSize(pageSize) {
    try {
      await loadHistory({ page: 1, pageSize });
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          SR
        </div>
        <div>
          <p className="eyebrow">AZVISION / VẬN HÀNH</p>
          <h1>Scheduled Replay</h1>
        </div>
        <div className="system-state">
          <span className="signal-dot" />
          <span>Điều phối cục bộ</span>
        </div>
      </header>

      <main>
        <Notice notice={notice} onClose={() => setNotice(null)} />

        <section className="hero" aria-labelledby="overview-title">
          <div>
            <p className="eyebrow">BẢNG ĐIỀU KHIỂN</p>
            <h2 id="overview-title">Lịch phát lại chấm công</h2>
            <p className="hero__description">
              Quản lý tài khoản, bộ ảnh và thời điểm chạy tự động từ một màn hình.
            </p>
          </div>
          <div className="metrics" aria-label="Tổng quan hệ thống">
            <div><strong>{profiles.length}</strong><span>Hồ sơ</span></div>
            <div><strong>{enabledCount}</strong><span>Đang bật</span></div>
            <div><strong>{historyTotal}</strong><span>Lượt thực thi</span></div>
          </div>
        </section>

        <section className="panel settings-panel" aria-labelledby="settings-title">
          <div className="section-heading">
            <div>
              <p className="section-number">01 / KẾT NỐI</p>
              <h2 id="settings-title">Cấu hình API</h2>
            </div>
            <span className="section-note">Đích xử lý phát lại</span>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <label className="field field--wide">
              <span>API Base URL</span>
              <input
                type="url"
                value={settings.apiBaseUrl || ""}
                onChange={(event) => setSettings({ apiBaseUrl: event.target.value })}
                placeholder="https://attendance.example.vn/api"
                required
              />
            </label>
            <button className="button button--primary" disabled={savingSettings}>
              {savingSettings ? "Đang lưu…" : "Lưu cấu hình"}
            </button>
          </form>
        </section>

        <section className="panel" aria-labelledby="profiles-title">
          <div className="section-heading">
            <div>
              <p className="section-number">02 / HỒ SƠ</p>
              <h2 id="profiles-title">Tài khoản nhân viên</h2>
            </div>
            <button className="button button--primary" type="button" onClick={beginCreate}>
              + Thêm hồ sơ
            </button>
          </div>

          {showForm && (
            <form className="profile-form" onSubmit={saveProfile}>
              <div className="form-title">
                <div>
                  <p className="eyebrow">{editingId ? "CHỈNH SỬA" : "HỒ SƠ MỚI"}</p>
                  <h3>{editingId ? "Cập nhật thông tin" : "Thiết lập tài khoản"}</h3>
                </div>
                <button className="icon-button" type="button" onClick={closeForm} aria-label="Đóng biểu mẫu">×</button>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Tên đăng nhập</span>
                  <input
                    value={profileForm.loginName}
                    onChange={(event) => setProfileForm({ ...profileForm, loginName: event.target.value })}
                    autoComplete="username"
                    required
                  />
                </label>
                <label className="field">
                  <span>Mật khẩu {editingId && <small>(để trống nếu giữ nguyên)</small>}</span>
                  <input
                    type="password"
                    value={profileForm.password}
                    onChange={(event) => setProfileForm({ ...profileForm, password: event.target.value })}
                    autoComplete="new-password"
                    required={!editingId}
                  />
                </label>
                <label className="field field--wide">
                  <span>Thư mục ảnh</span>
                  <input
                    value={profileForm.imageFolder}
                    onChange={(event) => setProfileForm({ ...profileForm, imageFolder: event.target.value })}
                    placeholder="/data/replay/employee-code"
                    required
                  />
                </label>
                <label className="field">
                  <span>Giờ chạy hàng ngày</span>
                  <input
                    type="time"
                    value={profileForm.scheduleTime}
                    onChange={(event) => setProfileForm({ ...profileForm, scheduleTime: event.target.value })}
                    required
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={profileForm.enabled}
                    onChange={(event) => setProfileForm({ ...profileForm, enabled: event.target.checked })}
                  />
                  Kích hoạt lịch ngay
                </label>
              </div>
              <div className="form-actions">
                <button className="button button--ghost" type="button" onClick={closeForm}>Hủy</button>
                <button className="button button--primary" disabled={savingProfile}>
                  {savingProfile ? "Đang lưu…" : editingId ? "Lưu thay đổi" : "Tạo hồ sơ"}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="empty-state">Đang tải hồ sơ…</div>
          ) : profiles.length === 0 ? (
            <div className="empty-state">
              <strong>Chưa có hồ sơ</strong>
              <span>Thêm tài khoản đầu tiên để bắt đầu lên lịch.</span>
            </div>
          ) : (
            <>
              <div className="table-wrap desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th>Tài khoản</th>
                      <th>Thư mục ảnh</th>
                      <th>Lịch chạy</th>
                      <th>Trạng thái</th>
                      <th><span className="sr-only">Thao tác</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.id} className={String(selectedId) === String(profile.id) ? "is-selected" : ""}>
                        <td>
                          <button className="identity" type="button" onClick={() => setSelectedId(profile.id)}>
                            <span className="avatar">{(profile.fullName || profile.loginName || "?").charAt(0).toUpperCase()}</span>
                            <span><strong>{profile.fullName || "Chưa đồng bộ"}</strong><small>{profile.employeeCode || profile.employeeId || "Chưa có mã NV"}</small></span>
                          </button>
                        </td>
                        <td>{profile.loginName}</td>
                        <td><span className="path-text" title={profile.imageFolder}>{profile.imageFolder}</span></td>
                        <td><span className="time-chip">{profile.scheduleTime}</span></td>
                        <td>
                          <div className="toggle-cell">
                            <Toggle checked={profile.enabled} onChange={() => toggleProfile(profile)} disabled={togglingId === profile.id} label={`${profile.enabled ? "Tắt" : "Bật"} lịch ${profile.loginName}`} />
                            <span>{profile.enabled ? "Đang bật" : "Đã tắt"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="button button--run" type="button" onClick={() => runProfile(profile)} disabled={runningId === profile.id}>{runningId === profile.id ? "Đang chạy…" : "Chạy ngay"}</button>
                            <button className="text-button" type="button" onClick={() => beginEdit(profile)}>Sửa</button>
                            <button className="text-button text-button--danger" type="button" onClick={() => removeProfile(profile)}>Xóa</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="profile-cards mobile-only">
                {profiles.map((profile) => (
                  <article className={`profile-card ${String(selectedId) === String(profile.id) ? "is-selected" : ""}`} key={profile.id}>
                    <button className="identity" type="button" onClick={() => setSelectedId(profile.id)}>
                      <span className="avatar">{(profile.fullName || profile.loginName || "?").charAt(0).toUpperCase()}</span>
                      <span><strong>{profile.fullName || profile.loginName}</strong><small>{profile.employeeCode || "Chưa có mã NV"}</small></span>
                    </button>
                    <div className="card-details"><span>Tài khoản</span><strong>{profile.loginName}</strong></div>
                    <div className="card-details"><span>Thư mục</span><strong>{profile.imageFolder}</strong></div>
                    <div className="card-details"><span>Lịch chạy</span><strong>{profile.scheduleTime}</strong></div>
                    <div className="card-toggle">
                      <span>{profile.enabled ? "Lịch đang bật" : "Lịch đã tắt"}</span>
                      <Toggle checked={profile.enabled} onChange={() => toggleProfile(profile)} disabled={togglingId === profile.id} label={`${profile.enabled ? "Tắt" : "Bật"} lịch ${profile.loginName}`} />
                    </div>
                    <div className="card-actions">
                      <button className="button button--run" type="button" onClick={() => runProfile(profile)} disabled={runningId === profile.id}>{runningId === profile.id ? "Đang chạy…" : "Chạy ngay"}</button>
                      <button className="text-button" type="button" onClick={() => beginEdit(profile)}>Sửa</button>
                      <button className="text-button text-button--danger" type="button" onClick={() => removeProfile(profile)}>Xóa</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="images-title">
          <div className="section-heading section-heading--images">
            <div>
              <p className="section-number">03 / BỘ ẢNH</p>
              <h2 id="images-title">Ảnh phát lại</h2>
            </div>
            <label className="field profile-picker">
              <span>Hồ sơ đang chọn</span>
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">Chọn một hồ sơ</option>
                {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName || profile.loginName}</option>)}
              </select>
            </label>
          </div>

          {!selectedProfile ? (
            <div className="empty-state"><span>Chọn hồ sơ để xem và tải ảnh lên.</span></div>
          ) : (
            <div className="image-layout">
              <form className="upload-zone" onSubmit={uploadImages}>
                <div className="upload-glyph" aria-hidden="true">↑</div>
                <strong>Tải ảnh cho {selectedProfile.fullName || selectedProfile.loginName}</strong>
                <span>Chọn nhiều ảnh trong một lần. Dữ liệu sẽ được lưu vào thư mục hồ sơ.</span>
                <input id="image-upload" name="images" type="file" accept="image/*" multiple required />
                <label className="button button--ghost" htmlFor="image-upload">Chọn ảnh</label>
                <button className="button button--primary" disabled={uploading}>{uploading ? "Đang tải lên…" : "Tải lên"}</button>
              </form>
              <div className="image-list">
                <div className="image-list__header"><strong>Danh sách ảnh</strong><span>{images.length} tệp</span></div>
                {images.length === 0 ? (
                  <div className="empty-state empty-state--small">Thư mục chưa có ảnh.</div>
                ) : (
                  <ul>
                    {images.map((image, index) => (
                      <li key={typeof image === "string" ? image : image.id || image.path || index}>
                        <span className="file-index">{String(index + 1).padStart(2, "0")}</span>
                        <span title={typeof image === "string" ? image : image.path}>{fileLabel(image)}</span>
                        <small>{typeof image === "object" && image.size ? `${Math.round(image.size / 1024)} KB` : "IMAGE"}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="history-title">
          <div className="section-heading section-heading--history">
            <div>
              <p className="section-number">04 / NHẬT KÝ</p>
              <h2 id="history-title">Lịch sử thực thi</h2>
            </div>
            <div className="history-controls">
              <label className="field">
                <span className="sr-only">Lọc theo hồ sơ</span>
                <select value={historyProfileId} onChange={(event) => filterHistory(event.target.value)}>
                  <option value="">Tất cả hồ sơ</option>
                  {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName || profile.loginName}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="sr-only">Lọc theo trạng thái</span>
                <select value={historyStatus} onChange={(event) => filterHistoryStatus(event.target.value)}>
                  <option value="">Tất cả trạng thái</option>
                  <option value="success">Thành công</option>
                  <option value="skipped">Bỏ qua</option>
                  <option value="failed">Thất bại</option>
                  <option value="running">Đang chạy</option>
                </select>
              </label>
              <label className="field page-size">
                <span className="sr-only">Số dòng mỗi trang</span>
                <select value={historyPageSize} onChange={(event) => changeHistoryPageSize(Number(event.target.value))}>
                  <option value="10">10 dòng</option>
                  <option value="20">20 dòng</option>
                  <option value="50">50 dòng</option>
                  <option value="100">100 dòng</option>
                </select>
              </label>
              <button className="button button--ghost" type="button" onClick={() => loadHistory().catch(reportError)}>Làm mới</button>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="empty-state"><span>Chưa có lượt thực thi nào.</span></div>
          ) : (
            <div className="table-wrap">
              <table className="history-table">
                <thead><tr><th>Thời gian</th><th>Hồ sơ</th><th>Kích hoạt</th><th>Kết quả</th><th>Số lần chấm</th><th>Thông tin</th></tr></thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td><span className="date-text">{formatDate(item.startedAt)}</span></td>
                      <td><strong>{item.profileName || item.employeeId || "—"}</strong></td>
                      <td><span className="trigger-chip">{item.trigger === "scheduled" ? "Theo lịch" : item.trigger === "manual" ? "Thủ công" : item.trigger || "—"}</span></td>
                      <td><span className={`status status--${String(item.status).toLowerCase()}`}>{item.status || "Không rõ"}</span></td>
                      <td>{item.checkCount ?? "—"}</td>
                      <td><span className="message-text" title={item.message || item.imagePath}>{item.message || item.imagePath || "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination" aria-label="Phân trang lịch sử">
            <span>{historyTotal} kết quả · Trang {historyPage}/{historyTotalPages}</span>
            <div>
              <button className="button button--ghost" type="button" disabled={historyPage <= 1} onClick={() => changeHistoryPage(historyPage - 1)}>Trang trước</button>
              <button className="button button--ghost" type="button" disabled={historyPage >= historyTotalPages} onClick={() => changeHistoryPage(historyPage + 1)}>Trang sau</button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>Scheduled Replay Console</span>
        <span>Lịch sử được lưu trong SQLite</span>
      </footer>
    </div>
  );
}
