// Load identicon utility
const script = document.createElement('script');
script.src = 'utils/identicon.js';
document.head.appendChild(script);

script.onload = function() {
  fetchLicenses();
  loadProfile();
};

// Profile menu toggle
function toggleProfileMenu() {
  const menu = document.querySelector('.profile-menu');
  const arrow = document.querySelector('.dropdown-arrow');
  
  if (menu.classList.contains('show')) {
    menu.classList.remove('show');
    arrow.style.transform = 'rotate(0deg)';
  } else {
    menu.classList.add('show');
    arrow.style.transform = 'rotate(180deg)';
  }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  const profileContainer = document.querySelector('.profile-container');
  if (!profileContainer.contains(e.target)) {
    const menu = document.querySelector('.profile-menu');
    const arrow = document.querySelector('.dropdown-arrow');
    menu.classList.remove('show');
    arrow.style.transform = 'rotate(0deg)';
  }
});

// Logout
document.getElementById("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  const token = localStorage.getItem("token");
  if (token) {
    try {
      await fetch("/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
  localStorage.removeItem("token");
  localStorage.removeItem("preferences");
  window.location = "login.html";
});

// Create license
document.getElementById("createLicenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalContent = submitBtn.innerHTML;
  
  submitBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416"/></svg><span>Aanmaken...</span>`;
  submitBtn.disabled = true;
  
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");

  const formData = new FormData(e.target);
  const aantal = parseInt(formData.get("aantal"));
  const max_leerlingen = parseInt(formData.get("max_leerlingen"));
  const vervalt_op = formData.get("vervalt_op");

  try {
    const res = await fetch("/admin/create-license", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        aantal,
        max_leerlingen,
        vervalt_op,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Kon licentie niet aanmaken");
    }

    e.target.reset();
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
    
    showNotification('✅ Licenties succesvol aangemaakt!', 'success');
    fetchLicenses();
  } catch (err) {
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
    showNotification(err.message || 'Fout bij aanmaken licentie', 'error');
  }
});

// Fetch licenses
async function fetchLicenses() {
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");

  try {
    const res = await fetch("/admin/licenses", {
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      if (res.status === 401) return (window.location = "login.html");
      throw new Error("Kon licenties niet laden");
    }

    const licenses = await res.json();

    const list = document.getElementById("licensesList");
    list.innerHTML = "";

    if (licenses.length === 0) {
      list.innerHTML = '<p class="helper">Geen licenties gevonden.</p>';
      return;
    }

    const ul = document.createElement("ul");
    licenses.forEach((license, index) => {
      const li = document.createElement("li");
      li.style.animationDelay = `${index * 0.05}s`;
      li.className = 'slide-in';
      
      const usagePercentage = license.huidige_leerlingen ? Math.round((license.huidige_leerlingen / license.max_leerlingen) * 100) : 0;
      const availableSlots = license.max_leerlingen - (license.huidige_leerlingen || 0);
      const statusClass = usagePercentage > 80 ? 'usage-high' : usagePercentage > 60 ? 'usage-medium' : 'usage-low';
      
      li.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <strong style="color: var(--md-sys-color-on-surface); font-size: 1rem;">${escapeHtml(license.klas_naam || 'Ongebruikte Licentie')}</strong>
            <div class="helper">
              <span class="status-badge ${license.is_redeemed ? 'status-active' : 'status-warning'}">
                ${license.is_redeemed ? 'Actief' : 'Niet Ingewisseld'}
              </span>
              <span style="margin-left: 8px;">${license.huidige_leerlingen || 0}/${license.max_leerlingen} leerlingen</span>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="background: var(--md-sys-color-surface-variant); padding: var(--space-sm) var(--space-md); border-radius: var(--md-sys-shape-corner-small); font-family: var(--md-sys-typescale-label-medium-font-family); font-weight: 600; color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">
              ${escapeHtml(license.licentie_code)}
            </div>
          </div>
        </div>
        
        <div style="margin-top: var(--space-sm);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs);">
            <span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">Gebruik</span>
            <span style="color: var(--md-sys-color-on-surface); font-weight: 600; font-size: 0.875rem;">${usagePercentage}%</span>
          </div>
          <div class="usage-bar">
            <div class="usage-fill ${statusClass}" style="width: ${usagePercentage}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: var(--space-xs);">
            <span class="helper" style="margin: 0;">${availableSlots} beschikbaar</span>
            ${license.vervalt_op ? `<span class="helper" style="margin: 0;">Vervalt: ${escapeHtml(license.vervalt_op)}</span>` : ''}
          </div>
        </div>
      `;
      ul.appendChild(li);
    });
    list.appendChild(ul);
  } catch (err) {
    console.error(err);
    showNotification("Kon licenties niet laden", 'error');
  }
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Load profile
async function loadProfile() {
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");

  try {
    const res = await fetch("/dashboard-data", {
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      if (res.status === 401) return (window.location = "login.html");
      throw new Error("Kon profiel niet laden");
    }

    const data = await res.json();

    document.getElementById("profile-name").textContent =
      data.docent?.naam || "Admin";
    
    // Generate identicon avatar
    if (typeof generateIdenticon !== 'undefined') {
      const avatarSeed = data.docent?.naam || data.docent?.email || "admin";
      const avatarUrl = generateIdenticon(avatarSeed, 48);
      document.getElementById("avatar").src = avatarUrl;
    } else {
      // Fallback
      document.getElementById(
        "avatar"
      ).src = `get_avatar.php?file=${encodeURIComponent(
        data.docent?.avatar || ""
      )}&seed=${encodeURIComponent(
        data.docent?.naam || "Admin"
      )}&size=48`;
    }
  } catch (err) {
    console.error("Profile load error:", err);
  }
}
