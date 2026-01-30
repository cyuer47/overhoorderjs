// Load identicon utility
const script = document.createElement('script');
script.src = 'utils/identicon.js';
document.head.appendChild(script);

script.onload = function() {
  fetchDashboard();
};

// View transition support
function navigateWithTransition(url) {
  if (!document.startViewTransition) {
    window.location.href = url;
    return;
  }
  document.startViewTransition(() => {
    window.location.href = url;
  });
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

// Logout with transition
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

// Create klas with Material 3 feedback
document.getElementById("createKlasForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalContent = submitBtn.innerHTML;
  
  submitBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416"/></svg><span>Aanmaken...</span>`;
  submitBtn.disabled = true;
  
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");
  
  const formData = new FormData(e.target);
  const naam = formData.get("klas_naam").trim();
  const vak = formData.get("vak").trim();
  
  try {
    const res = await fetch("/create-klas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ naam, vak }),
    });
    
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Kon klas niet aanmaken");
    }
    
    e.target.reset();
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
    
    showNotification('✅ Klas succesvol aangemaakt!', 'success');
    fetchDashboard();
  } catch (err) {
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
    showNotification(err.message || 'Fout bij aanmaken klas', 'error');
  }
});

// Delete klas
async function deleteKlas(klasId) {
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");
  
  try {
    const res = await fetch(`/delete-klas?id=${klasId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Kon klas niet verwijderen");
    }
    
    showNotification('🗑️ Klas succesvol verwijderd', 'success');
    fetchDashboard();
  } catch (err) {
    showNotification(err.message || 'Fout bij verwijderen klas', 'error');
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

// Fetch dashboard data
async function fetchDashboard() {
  const token = localStorage.getItem("token");
  if (!token) return (window.location = "login.html");
  
  try {
    const res = await fetch("/dashboard-data", {
      headers: { Authorization: "Bearer " + token },
    });
    
    if (!res.ok) {
      if (res.status === 401) return (window.location = "login.html");
      throw new Error("Kon dashboard niet laden");
    }
    
    const j = await res.json();
    
    // Update profile with identicon
    document.getElementById("profile-name").textContent = j.docent?.naam || "Docent";
    
    // Generate identicon avatar
    if (typeof generateIdenticon !== 'undefined') {
      const avatarSeed = j.docent?.naam || j.docent?.email || "default";
      const avatarUrl = generateIdenticon(avatarSeed, 48);
      document.getElementById("avatar").src = avatarUrl;
    } else {
      // Fallback to old avatar system
      document.getElementById("avatar").src = `get_avatar.php?file=${encodeURIComponent(j.docent?.avatar || "")}&seed=${encodeURIComponent(j.docent?.naam || "Docent")}&size=48`;
    }
    
    // Show admin link
    if (j.docent?.id === 1) {
      document.getElementById("admin-link").style.display = "block";
    }
    
    // Render klassen
    const kl = document.getElementById("klassenList");
    kl.innerHTML = "";
    if (!j.klassen || j.klassen.length === 0) {
      kl.innerHTML = '<p class="helper">Nog geen klassen.</p>';
    } else {
      const ul = document.createElement("ul");
      j.klassen.forEach((k, index) => {
        const li = document.createElement("li");
        li.style.animationDelay = `${index * 0.1}s`;
        li.className = 'slide-in';
        li.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <strong style="color: var(--md-sys-color-on-surface); font-size: 1rem;">${escapeHtml(k.naam)}</strong>
              <div class="helper">
                <span class="status-badge status-active">Klascode: ${escapeHtml(k.klascode)}</span>
                ${k.vak ? `<span style="margin-left: 8px;">Vak: ${escapeHtml(k.vak)}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="margin-top: var(--space-sm); display: flex; gap: var(--space-sm); flex-wrap: wrap;">
            <a class="btn-secondary" href="manage_klas.html?klas=${k.id}" style="font-size: 0.8rem; padding: 0.5rem 1rem;">
              Beheren
            </a>
            <a class="btn-primary" href="start_sessie.html?klas=${k.id}" style="font-size: 0.8rem; padding: 0.5rem 1rem;">
              Start Overhoring
            </a>
            <button class="btn-danger" onclick="if(confirm('Weet je zeker dat je deze klas wilt verwijderen? Alle leerlingen, vragen en resultaten worden ook verwijderd.')) deleteKlas(${k.id})" style="font-size: 0.8rem; padding: 0.5rem 1rem;">
              Verwijderen
            </button>
          </div>
        `;
        ul.appendChild(li);
      });
      kl.appendChild(ul);
    }
    
    // Render other sections (bibliotheek, boeken, etc.)
    renderOtherSections(j);
    
  } catch (err) {
    console.error(err);
    showNotification("Kon dashboard niet laden", 'error');
  }
}

// Render other dashboard sections
function renderOtherSections(j) {
  // Bibliotheek
  const bl = document.getElementById("biblioList");
  bl.innerHTML = "";
  if (!j.biblio_lijsten || j.biblio_lijsten.length === 0) {
    bl.innerHTML = '<p class="helper">Geen vragenlijsten in bibliotheek.</p>';
  } else {
    const ul = document.createElement("ul");
    j.biblio_lijsten.forEach((l) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(l.titel)}</strong><div class="helper">${l.vragen_count} vragen</div>`;
      ul.appendChild(li);
    });
    bl.appendChild(ul);
  }

  // Boeken
  const bo = document.getElementById("boekenList");
  bo.innerHTML = "";
  if (!j.boeken || j.boeken.length === 0) {
    bo.innerHTML = '<p class="helper">Geen boeken licenties.</p>';
  } else {
    const ul = document.createElement("ul");
    j.boeken.forEach((b) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(b.titel)}</strong><div class="helper">${b.omschrijving}</div>`;
      ul.appendChild(li);
    });
    bo.appendChild(ul);
  }

  // Licenties
  renderLicenses(j);
}

// Render licenses section
function renderLicenses(j) {
  const liEl = document.getElementById("licentiesList");
  liEl.innerHTML = "";
  
  if (j.licenties.length === 0) {
    liEl.innerHTML = `
      <div style="text-align: center; padding: var(--space-xl);">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, var(--md-sys-color-surface-variant), var(--md-sys-color-surface-container-high)); border-radius: var(--md-sys-shape-corner-large); display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-md);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="11" width="18" height="10" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
            <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h4 style="color: var(--md-sys-color-on-surface-variant); margin-bottom: var(--space-sm);">Geen Licenties</h4>
        <p class="helper">Je hebt nog geen actieve licenties. Wissel een licentiecode in om te beginnen.</p>
      </div>
    `;
  } else {
    const licensesContainer = document.createElement('div');
    licensesContainer.className = 'licenses-list';
    
    j.licenties.forEach((L, index) => {
      const usagePercentage = L.huidige_leerlingen ? Math.round((L.huidige_leerlingen / L.max_leerlingen) * 100) : 0;
      const availableSlots = L.max_leerlingen - (L.huidige_leerlingen || 0);
      const statusClass = usagePercentage > 80 ? 'usage-high' : usagePercentage > 60 ? 'usage-medium' : 'usage-low';
      
      const licenseCard = document.createElement('div');
      licenseCard.className = 'license-card fade-in';
      licenseCard.style.animationDelay = `${index * 0.1}s`;
      licenseCard.style.cssText = `
        background-color: var(--md-sys-color-surface-container-high);
        border-radius: var(--md-sys-shape-corner-medium);
        padding: var(--space-lg);
        margin-bottom: var(--space-md);
        transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
        position: relative;
        overflow: hidden;
      `;
      
      licenseCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: var(--space-md);">
          <div>
            <h4 style="color: var(--md-sys-color-on-surface); margin: 0; font-size: 1.1rem;">
              ${escapeHtml(L.klas_naam || 'Ongebruikte Licentie')}
            </h4>
            <div style="display: flex; gap: var(--space-sm); margin-top: var(--space-xs);">
              <span class="status-badge ${L.is_redeemed ? 'status-active' : 'status-warning'}">
                ${L.is_redeemed ? 'Actief' : 'Niet Ingewisseld'}
              </span>
              <span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">
                ${L.huidige_leerlingen || 0}/${L.max_leerlingen} leerlingen
              </span>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="background: var(--md-sys-color-surface-variant); padding: var(--space-sm) var(--space-md); border-radius: var(--md-sys-shape-corner-small); font-family: var(--md-sys-typescale-label-medium-font-family); font-weight: 600; color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">
              ${escapeHtml(L.licentie_code)}
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: var(--space-md);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs);">
            <span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">Gebruik</span>
            <span style="color: var(--md-sys-color-on-surface); font-weight: 600; font-size: 0.875rem;">${usagePercentage}%</span>
          </div>
          <div class="usage-bar">
            <div class="usage-fill ${statusClass}" style="width: ${usagePercentage}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: var(--space-xs);">
            <span class="helper" style="margin: 0;">${availableSlots} beschikbaar</span>
            ${L.vervalt_op ? `<span class="helper" style="margin: 0;">Vervalt: ${escapeHtml(L.vervalt_op)}</span>` : ''}
          </div>
        </div>
      `;
      
      licenseCard.addEventListener('mouseenter', () => {
        licenseCard.style.transform = 'translateY(-1px)';
        licenseCard.style.boxShadow = 'var(--md-sys-elevation-level2)';
      });
      
      licenseCard.addEventListener('mouseleave', () => {
        licenseCard.style.transform = 'translateY(0)';
        licenseCard.style.boxShadow = 'none';
      });
      
      licensesContainer.appendChild(licenseCard);
    });
    
    liEl.appendChild(licensesContainer);
  }
  
  // Add redeem license button
  const redeemSection = document.createElement('div');
  redeemSection.className = 'fade-in';
  redeemSection.style.animationDelay = '0.6s';
  redeemSection.innerHTML = `
    <div style="text-align: center; padding: var(--space-lg); background: linear-gradient(135deg, var(--md-sys-color-primary-container), var(--md-sys-color-secondary-container)); border-radius: var(--md-sys-shape-corner-medium); border: 1px solid var(--md-sys-color-primary);">
      <div style="width: 48px; height: 48px; background: linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary)); border-radius: var(--md-sys-shape-corner-medium); display: flex; align-items: center; justify-content: center; margin: 0 auto var(--space-md);">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 24L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2Z" fill="white" opacity="0.2"/>
          <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 24L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 12L11 14L15 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h4 style="color: var(--md-sys-color-on-primary-container); margin-bottom: var(--space-sm);">Licentiecode Inwisselen</h4>
      <p class="helper" style="margin-bottom: var(--space-md);">Heb je een licentiecode? Wissel deze hier in om je licentie te activeren.</p>
      <button class="btn-primary" onclick="showRedeemLicenseModal()" style="background: linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary));">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: var(--space-sm);">
          <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 24L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Licentiecode Inwisselen
      </button>
    </div>
  `;
  liEl.appendChild(redeemSection);
}

// Show redeem license modal
function showRedeemLicenseModal() {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background-color: var(--md-sys-color-scrim);
    opacity: 0.5;
    z-index: var(--z-modal-backdrop);
    backdrop-filter: blur(4px);
    animation: fadeIn var(--md-sys-motion-duration-medium4) var(--md-sys-motion-easing-emphasized);
  `;
  
  modal.innerHTML = `
    <div class="modal-content fade-in" style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: var(--md-sys-color-surface-container);
      border-radius: var(--md-sys-shape-corner-extra-large);
      box-shadow: var(--md-sys-elevation-level5);
      z-index: var(--z-modal);
      max-width: 500px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      padding: var(--space-xl);
    ">
      <div style="text-align: center; margin-bottom: 2rem;">
        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary)); border-radius: var(--md-sys-shape-corner-extra-large); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; animation: float 3s ease-in-out infinite;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 24L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2Z" fill="white" opacity="0.2"/>
            <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 24L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 12L11 14L15 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3 style="margin: 0; color: var(--md-sys-color-on-surface); font-size: 1.875rem; font-weight: 700;">Licentiecode Activeren</h3>
        <p style="margin: 0.75rem 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 1rem; line-height: 1.5;">Voer je unieke licentiecode in om je licentie te activeren en toegang te krijgen tot alle functies.</p>
      </div>
      
      <form id="redeemLicenseForm">
        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; margin-bottom: 0.75rem; color: var(--md-sys-color-on-surface); font-weight: 600; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em;">Licentiecode</label>
          <input type="text" name="licentie_code" placeholder="XXXX-XXXX-XXXX" required style="
            width: 100%; 
            padding: 1rem; 
            border: 2px solid var(--md-sys-color-outline); 
            border-radius: var(--md-sys-shape-corner-large); 
            font-size: 1rem; 
            font-weight: 500; 
            font-family: var(--md-sys-typescale-label-large-font-family);
            transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard); 
            background-color: var(--md-sys-color-surface-container);
            text-align: center;
            letter-spacing: 2px;
          " onfocus="this.style.borderColor='var(--md-sys-color-primary)'; this.style.boxShadow='0 0 0 2px var(--md-sys-color-primary-container)'; this.style.transform='translateY(-1px)';" onblur="this.style.borderColor='var(--md-sys-color-outline)'; this.style.boxShadow='none'; this.style.transform='translateY(0)';" />
          <p style="margin: 0.5rem 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 0.813rem; text-align: center;">De code vind je op je licentiebewijs of in de e-mail die je hebt ontvangen</p>
        </div>
        
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
          <button type="button" onclick="this.closest('div[style*=position]').remove()" class="btn-secondary">Annuleren</button>
          <button type="submit" class="btn-primary" style="background: linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary));">Licentie Activeren</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.animation = 'fadeOut var(--md-sys-motion-duration-medium4) var(--md-sys-motion-easing-emphasized)';
      setTimeout(() => {
        if (modal.parentNode) {
          modal.remove();
        }
      }, 400);
    }
  });
  
  modal.querySelector('#redeemLicenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) return (window.location = "login.html");
    
    const formData = new FormData(e.target);
    const licentie_code = formData.get('licentie_code').trim().toUpperCase();
    
    // Show loading state
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span style="display: inline-flex; align-items: center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416"/></svg>Bezig met activeren...</span>';
    submitBtn.disabled = true;
    
    try {
      const res = await fetch("/redeem-license", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ licentie_code }),
      });
      
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Kon licentie niet activeren");
      }
      
      modal.style.animation = 'fadeOut var(--md-sys-motion-duration-medium4) var(--md-sys-motion-easing-emphasized)';
      setTimeout(() => {
        if (modal.parentNode) {
          modal.remove();
        }
        fetchDashboard();
        showNotification('🎉 Licentie succesvol geactiveerd! Je kunt nu klassen aanmaken en alle functies gebruiken.', 'success');
      }, 400);
    } catch (err) {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
      showNotification(err.message || 'Netwerkfout bij activeren licentie', 'error');
    }
  });
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
