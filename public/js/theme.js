/**
 * Theme handling for Giant Swarm PRO
 * Simple theme switcher that supports light/dark mode
 */

// Initialize theme immediately
(function() {
  const savedTheme = localStorage.getItem('gs-theme');
  const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Apply theme based on: 1) User preference 2) System preference 3) Light default
  document.documentElement.setAttribute('data-theme', 
    savedTheme || (prefersDarkMode ? 'dark' : 'light'));
})();

// Set up theme toggle functionality when DOM is ready
document.addEventListener("DOMContentLoaded", function() {
  const themeToggler = document.getElementById('theme-toggle');
  
  if (!themeToggler) return;
  
  // Update the toggle button icon based on current theme
  function updateToggleIcon() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    themeToggler.innerHTML = currentTheme === 'dark' 
      ? '<i class="bi bi-sun-fill"></i>' 
      : '<i class="bi bi-moon-fill"></i>';
    themeToggler.setAttribute('title', 
      currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  
  // Set the theme and update UI
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gs-theme', theme);
    updateToggleIcon();
  }
  
  // Initialize toggle icon state
  updateToggleIcon();
  
  // Handle toggle button click
  themeToggler.addEventListener('click', function() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });
  
  // Handle keyboard shortcut (Ctrl+Shift+T)
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const currentTheme = document.documentElement.getAttribute('data-theme');
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }
  });
}); 