// Load identicon utility
const script = document.createElement('script');
script.src = 'utils/identicon.js';
document.head.appendChild(script);

script.onload = function() {
  initializeSettings();
};

function initializeSettings() {
  loadProfile();
  setupEventListeners();
}

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

// Load profile data
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

    // Update profile info
    document.getElementById("profile-name").textContent = data.docent?.naam || "Docent";
    document.getElementById("naam").value = data.docent?.naam || "";
    document.getElementById("email").value = data.docent?.email || "";

    // Generate identicon avatar
    if (typeof generateIdenticon !== 'undefined') {
      const avatarSeed = data.docent?.naam || data.docent?.email || "default";
      const avatarUrl = generateIdenticon(avatarSeed, 64);
      document.getElementById("avatar").src = avatarUrl;
      document.getElementById("avatarPreview").src = avatarUrl;
    } else {
      // Fallback
      document.getElementById("avatar").src = `get_avatar.php?file=${encodeURIComponent(data.docent?.avatar || "")}&seed=${encodeURIComponent(data.docent?.naam || "Docent")}&size=64`;
      document.getElementById("avatarPreview").src = document.getElementById("avatar").src;
    }

    // Show admin link
    if (data.docent?.id === 1) {
      document.getElementById("admin-link").style.display = "block";
    }

    // Load saved preferences
    loadPreferences();
  } catch (err) {
    console.error("Profile load error:", err);
    showNotification("Kon profiel niet laden", 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  // Profile form
  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalContent = submitBtn.innerHTML;
    
    submitBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416"/></svg><span>Bijwerken...</span>`;
    submitBtn.disabled = true;
    
    const token = localStorage.getItem("token");
    if (!token) return (window.location = "login.html");

    const formData = new FormData(e.target);
    const naam = formData.get("naam").trim();

    try {
      const res = await fetch("/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ naam }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Kon profiel niet bijwerken");
      }

      submitBtn.innerHTML = originalContent;
      submitBtn.disabled = false;
      
      showNotification('✅ Profiel succesvol bijgewerkt!', 'success');
      
      // Update profile name in header
      document.getElementById("profile-name").textContent = naam;
    } catch (err) {
      submitBtn.innerHTML = originalContent;
      submitBtn.disabled = false;
      showNotification(err.message || 'Fout bij bijwerken profiel', 'error');
    }
  });

  // Password form
  document.getElementById("passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalContent = submitBtn.innerHTML;
    
    const formData = new FormData(e.target);
    const current_password = formData.get("current_password");
    const new_password = formData.get("new_password");
    const confirm_password = formData.get("confirm_password");

    // Validate passwords match
    if (new_password !== confirm_password) {
      showNotification('Wachtwoorden komen niet overeen', 'error');
      return;
    }

    submitBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416"/></svg><span>Wijzigen...</span>`;
    submitBtn.disabled = true;
    
    const token = localStorage.getItem("token");
    if (!token) return (window.location = "login.html");

    try {
      const res = await fetch("/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ current_password, new_password }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Kon wachtwoord niet wijzigen");
      }

      e.target.reset();
      submitBtn.innerHTML = originalContent;
      submitBtn.disabled = false;
      
      showNotification('✅ Wachtwoord succesvol gewijzigd!', 'success');
    } catch (err) {
      submitBtn.innerHTML = originalContent;
      submitBtn.disabled = false;
      showNotification(err.message || 'Fout bij wijzigen wachtwoord', 'error');
    }
  });

  // Theme selection
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      savePreference('theme', theme);
    });
  });

  // Language selection
  document.querySelector('select[name="language"]').addEventListener('change', (e) => {
    const language = e.target.value;
    savePreference('language', language);
    applyLanguage(language);
    showNotification('Taalvoorkeur opgeslagen', 'success');
  });
}

// Generate new avatar
function generateNewAvatar() {
  const naam = document.getElementById("naam").value || "default";
  const email = document.getElementById("email").value;
  const seed = naam + email + Date.now(); // Add timestamp for uniqueness
  
  if (typeof generateIdenticon !== 'undefined') {
    const avatarUrl = generateIdenticon(seed, 64);
    document.getElementById("avatar").src = avatarUrl;
    document.getElementById("avatarPreview").src = avatarUrl;
    showNotification('Nieuwe avatar gegenereerd!', 'success');
  }
}

// Apply theme
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
    // Check system preference for auto
    if (theme === 'auto' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }
}

// Apply language
function applyLanguage(language) {
  // Update HTML lang attribute
  document.documentElement.lang = language;
  
  // In a real implementation, you would translate the UI here
  // For now, we just save the preference
  console.log('Language applied:', language);
}

// Save preference
function savePreference(key, value) {
  const preferences = JSON.parse(localStorage.getItem('preferences') || '{}');
  preferences[key] = value;
  localStorage.setItem('preferences', JSON.stringify(preferences));
}

// Load preferences
function loadPreferences() {
  const preferences = JSON.parse(localStorage.getItem('preferences') || '{}');
  
  // Apply theme
  const theme = preferences.theme || 'auto';
  document.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
  applyTheme(theme);
  
  // Apply language
  const language = preferences.language || 'nl';
  document.querySelector('select[name="language"]').value = language;
  applyLanguage(language);
}

// Confirm delete account
function confirmDeleteAccount() {
  if (confirm('Weet je zeker dat je je account wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.')) {
    if (confirm('Alle je gegevens, klassen, vragen en resultaten worden permanent verwijderd. Weet je het zeker?')) {
      deleteAccount();
    }
  }
}

// Delete account
async function deleteAccount() {
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");

  try {
    const res = await fetch("/delete-account", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Kon account niet verwijderen");
    }

    showNotification('Account succesvol verwijderd', 'success');
    localStorage.removeItem("token");
    localStorage.removeItem("preferences");
    window.location = "login.html";
  } catch (err) {
    showNotification(err.message || 'Fout bij verwijderen account', 'error');
  }
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
