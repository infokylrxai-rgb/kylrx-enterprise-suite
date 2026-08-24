import { db } from "./firebase-config.js";
import { collection, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Sticky Navbar Background on Scroll
const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    navbar.style.background = 'rgba(255, 255, 255, 0.95)';
    navbar.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.05)';
  } else {
    navbar.style.background = 'rgba(255, 255, 255, 0.8)';
    navbar.style.boxShadow = 'none';
  }
});

// Simple Reveal Animation on Scroll
const observerOptions = {
  threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('reveal');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll('.feature-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'all 0.6s ease-out';
  observer.observe(el);
});

// Dynamic class injection for reveal
const style = document.createElement('style');
style.textContent = `
  .reveal {
    opacity: 1 !important;
    transform: translateY(0) !important;
  }
`;
document.head.appendChild(style);

// Smooth Scroll for Nav Links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });
});

// Mobile Menu Toggle
const mobileToggle = document.querySelector('.mobile-toggle');
const navLinksContainer = document.querySelector('.nav-links');

if (mobileToggle && navLinksContainer) {
  mobileToggle.addEventListener('click', () => {
    navLinksContainer.classList.toggle('active');
    const icon = mobileToggle.querySelector('i');
    if (navLinksContainer.classList.contains('active')) {
      icon.setAttribute('data-lucide', 'x');
    } else {
      icon.setAttribute('data-lucide', 'menu');
    }
    if (window.lucide) { lucide.createIcons(); }
  });

  // Close menu when clicking a link
  document.querySelectorAll('.nav-link, .nav-btn').forEach(link => {
    link.addEventListener('click', () => {
      navLinksContainer.classList.remove('active');
      const icon = mobileToggle.querySelector('i');
      icon.setAttribute('data-lucide', 'menu');
      if (window.lucide) { lucide.createIcons(); }
    });
  });
}

console.log('HRFlow Landing Page Initialized');

// --- Real-time Backend Telemetry ---
function initBackendTelemetry() {
  const statusLabel = document.querySelector('.status-label');
  const statusDot = document.querySelector('.status-dot');
  const liveUsersEl = document.getElementById('live-users');
  const activeUnitsEl = document.getElementById('secure-units');

  if (!statusLabel || !statusDot) return;

  // Set connecting state
  statusDot.className = 'status-dot connecting';
  statusLabel.textContent = 'Cloud Backend: Connecting...';

  try {
    // 1. Listen for Live Users (Activity Status)
    onSnapshot(collection(db, 'activityStatus'), (snapshot) => {
      const count = snapshot.size;
      if (liveUsersEl) {
        liveUsersEl.textContent = count > 0 ? (count + '+') : '12+';
      }
      
      // Update status once we have a successful connection
      statusDot.className = 'status-dot pulsing';
      statusLabel.textContent = 'Cloud Backend: Operational';
    }, (error) => {
      console.warn('Firebase connection restricted:', error.message);
      statusLabel.textContent = 'Cloud Backend: Standby (Demo)';
      statusDot.className = 'status-dot';
      if (liveUsersEl) liveUsersEl.textContent = '10k+';
      if (activeUnitsEl) activeUnitsEl.textContent = '12';
    });

    // 2. Fetch Secure Units (Command Centers)
    getDocs(collection(db, 'command_centers')).then(snap => {
      if (activeUnitsEl) {
        activeUnitsEl.textContent = snap.size > 0 ? snap.size : '8';
      }
    }).catch(() => {
        if (activeUnitsEl) activeUnitsEl.textContent = '8';
    });

  } catch (err) {
    console.error('Telemetry Initialization Failed:', err);
  }
}

// Start telemetry after a short delay for smooth loading
setTimeout(initBackendTelemetry, 1000);



