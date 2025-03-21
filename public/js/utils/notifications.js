/**
 * Notifications Module
 * 
 * WHY:
 * This module serves as a centralized system for all notifications in the application.
 * By consolidating various notification types (toasts, alerts, status messages) into a single,
 * consistent API, we improve UX consistency, simplify code maintenance, and ensure
 * accessibility standards are met throughout the application.
 * 
 * HOW:
 * The module provides a unified API for different notification types:
 * - Toast notifications (brief, auto-dismissing)
 * - Alerts (persistent until dismissed)
 * - Status updates (inline contextual messages)
 * 
 * Each notification type shares consistent styling, positioning, and accessibility
 * features while adapting to the application's theming system.
 * 
 * WHAT:
 * This module exports a notifications object with methods for creating and managing
 * different types of notifications, with configurable options for customization.
 */

/**
 * Notification positions
 * @enum {string}
 */
export const POSITIONS = {
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  TOP_CENTER: 'top-center',
  BOTTOM_CENTER: 'bottom-center'
};

/**
 * Notification types
 * @enum {string}
 */
export const TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

/**
 * Default notification options
 * @type {Object}
 */
const DEFAULT_OPTIONS = {
  type: TYPES.INFO,
  duration: 5000,
  dismissible: true,
  position: POSITIONS.BOTTOM_RIGHT,
  animationDuration: 300,
  icon: true,
  ariaLive: 'polite'
};

/**
 * Icons for each notification type
 * @type {Object}
 */
const ICONS = {
  [TYPES.INFO]: 'bi-info-circle',
  [TYPES.SUCCESS]: 'bi-check-circle',
  [TYPES.WARNING]: 'bi-exclamation-triangle',
  [TYPES.ERROR]: 'bi-x-circle'
};

/**
 * Maps notification types to Bootstrap classes
 * @type {Object}
 */
const TYPE_CLASSES = {
  [TYPES.INFO]: 'info',
  [TYPES.SUCCESS]: 'success',
  [TYPES.WARNING]: 'warning',
  [TYPES.ERROR]: 'danger'
};

/**
 * Cached container elements for different positions
 * @type {Object}
 */
const containers = {};

/**
 * Creates or returns a container for a specific position
 * @param {string} position - Position of the container
 * @returns {HTMLElement} Container element
 */
function getContainer(position) {
  if (containers[position]) {
    return containers[position];
  }
  
  const container = document.createElement('div');
  container.className = `notifications-container notifications-${position}`;
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  document.body.appendChild(container);
  
  containers[position] = container;
  return container;
}

/**
 * Creates a notification element
 * @param {string} message - Notification message
 * @param {Object} options - Notification options
 * @returns {HTMLElement} Notification element
 */
function createNotificationElement(message, options) {
  const { type, dismissible, icon, ariaLive } = options;
  const bootstrapType = TYPE_CLASSES[type];
  
  const notificationEl = document.createElement('div');
  notificationEl.className = `notification notification-${type}`;
  notificationEl.setAttribute('role', 'alert');
  notificationEl.setAttribute('aria-live', ariaLive);
  
  let iconHtml = '';
  if (icon && ICONS[type]) {
    iconHtml = `<i class="bi ${ICONS[type]} notification-icon"></i>`;
  }
  
  let closeButtonHtml = '';
  if (dismissible) {
    closeButtonHtml = `
      <button type="button" class="notification-close" aria-label="Close">
        <i class="bi bi-x"></i>
      </button>
    `;
  }
  
  notificationEl.innerHTML = `
    <div class="notification-content">
      ${iconHtml}
      <div class="notification-message">${message}</div>
      ${closeButtonHtml}
    </div>
  `;
  
  if (dismissible) {
    const closeButton = notificationEl.querySelector('.notification-close');
    closeButton.addEventListener('click', () => {
      removeNotification(notificationEl);
    });
    
    // Allow keyboard dismissal with Escape key
    notificationEl.tabIndex = 0;
    notificationEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        removeNotification(notificationEl);
      }
    });
  }
  
  return notificationEl;
}

/**
 * Removes a notification with animation
 * @param {HTMLElement} notification - The notification element to remove
 */
function removeNotification(notification) {
  notification.classList.add('notification-hiding');
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
      
      // Check if container is empty and remove if needed
      const container = notification.parentNode;
      if (container && container.childNodes.length === 0) {
        cleanupEmptyContainers();
      }
    }
  }, DEFAULT_OPTIONS.animationDuration);
}

/**
 * Cleans up empty notification containers
 */
function cleanupEmptyContainers() {
  Object.keys(containers).forEach(position => {
    const container = containers[position];
    if (container && container.childNodes.length === 0) {
      document.body.removeChild(container);
      delete containers[position];
    }
  });
}

/**
 * The notifications object with methods for different notification types
 */
const notifications = {
  /**
   * Show a notification
   * @param {Object} config - Configuration object
   * @param {string} config.message - The message to display
   * @param {string} [config.type=info] - Notification type: 'info', 'success', 'warning', 'error'
   * @param {number} [config.duration=5000] - Duration in ms (0 for no auto-dismiss)
   * @param {boolean} [config.dismissible=true] - Whether notification can be dismissed
   * @param {string} [config.position=bottom-right] - Position of the notification
   * @param {boolean} [config.icon=true] - Whether to show an icon
   * @param {string} [config.ariaLive=polite] - ARIA live value: 'polite', 'assertive', 'off'
   * @returns {HTMLElement} The notification element
   */
  show(config) {
    const options = { ...DEFAULT_OPTIONS, ...config };
    const { message, position, duration } = options;
    
    if (!message) {
      console.warn('Notification message is required');
      return null;
    }
    
    const container = getContainer(position);
    const notificationEl = createNotificationElement(message, options);
    
    // Add to DOM
    container.appendChild(notificationEl);
    
    // Force browser reflow to ensure animation works
    void notificationEl.offsetWidth;
    
    // Add visible class for animation
    notificationEl.classList.add('notification-visible');
    
    // Auto-dismiss if duration is set
    if (duration > 0) {
      setTimeout(() => {
        if (document.body.contains(notificationEl)) {
          removeNotification(notificationEl);
        }
      }, duration);
    }
    
    return notificationEl;
  },
  
  /**
   * Show a success notification
   * @param {string} message - The message to display
   * @param {Object} [options={}] - Additional options
   * @returns {HTMLElement} The notification element
   */
  success(message, options = {}) {
    return this.show({ message, type: TYPES.SUCCESS, ...options });
  },
  
  /**
   * Show an error notification
   * @param {string} message - The message to display
   * @param {Object} [options={}] - Additional options
   * @returns {HTMLElement} The notification element
   */
  error(message, options = {}) {
    return this.show({ 
      message, 
      type: TYPES.ERROR, 
      ariaLive: 'assertive',
      ...options 
    });
  },
  
  /**
   * Show a warning notification
   * @param {string} message - The message to display
   * @param {Object} [options={}] - Additional options
   * @returns {HTMLElement} The notification element
   */
  warning(message, options = {}) {
    return this.show({ message, type: TYPES.WARNING, ...options });
  },
  
  /**
   * Show an info notification
   * @param {string} message - The message to display
   * @param {Object} [options={}] - Additional options
   * @returns {HTMLElement} The notification element
   */
  info(message, options = {}) {
    return this.show({ message, type: TYPES.INFO, ...options });
  },
  
  /**
   * Update the status text in a specific element
   * @param {string} message - The message to display
   * @param {Object} options - Status options
   * @param {string} options.elementId - ID of the element to update
   * @param {string} [options.type=info] - Status type: 'info', 'success', 'warning', 'error'
   * @param {boolean} [options.loading=false] - Whether to show a loading spinner
   */
  updateStatus(message, options = {}) {
    const { elementId, type = TYPES.INFO, loading = false } = options;
    const bootstrapType = TYPE_CLASSES[type];
    
    const statusEl = document.getElementById(elementId);
    if (!statusEl) return;
    
    let icon = '';
    if (loading) {
      icon = '<span class="spinner-icon"><i class="bi bi-arrow-repeat"></i></span>';
    } else if (ICONS[type]) {
      icon = `<i class="bi ${ICONS[type]}"></i>`;
    }
    
    statusEl.innerHTML = message ? `<p class="text-${bootstrapType} mb-0">${icon} ${message}</p>` : '';
    statusEl.style.display = message ? 'block' : 'none';
  },
  
  /**
   * Create an inline alert
   * @param {string} message - The message to display
   * @param {Object} options - Alert options
   * @param {string} options.container - Selector for the container element
   * @param {string} [options.type=info] - Alert type: 'info', 'success', 'warning', 'error'
   * @param {boolean} [options.dismissible=true] - Whether alert can be dismissed
   * @param {string} [options.id] - Optional ID for the alert
   * @returns {HTMLElement} The alert element
   */
  createAlert(message, options = {}) {
    const { 
      container, 
      type = TYPES.INFO, 
      dismissible = true, 
      id = `alert-${Date.now()}` 
    } = options;
    
    const bootstrapType = TYPE_CLASSES[type];
    const containerEl = document.querySelector(container);
    
    if (!containerEl) {
      console.warn(`Alert container '${container}' not found`);
      return null;
    }
    
    // Create alert element
    const alertEl = document.createElement('div');
    alertEl.id = id;
    alertEl.className = `alert alert-${bootstrapType}`;
    alertEl.setAttribute('role', 'alert');
    
    let dismissButton = '';
    if (dismissible) {
      alertEl.classList.add('alert-dismissible', 'fade', 'show');
      dismissButton = `
        <button type="button" class="btn-close" aria-label="Close"></button>
      `;
    }
    
    let icon = '';
    if (ICONS[type]) {
      icon = `<i class="bi ${ICONS[type]} me-2"></i>`;
    }
    
    alertEl.innerHTML = `
      ${icon}${message}
      ${dismissButton}
    `;
    
    // Add click handler for dismiss button
    if (dismissible) {
      const closeBtn = alertEl.querySelector('.btn-close');
      closeBtn.addEventListener('click', () => {
        alertEl.classList.remove('show');
        setTimeout(() => {
          if (alertEl.parentNode) {
            alertEl.parentNode.removeChild(alertEl);
          }
        }, DEFAULT_OPTIONS.animationDuration);
      });
    }
    
    // Add to container
    containerEl.appendChild(alertEl);
    
    return alertEl;
  },
  
  /**
   * Dismiss all notifications
   */
  dismissAll() {
    Object.values(containers).forEach(container => {
      const notifications = container.querySelectorAll('.notification');
      notifications.forEach(notification => {
        removeNotification(notification);
      });
    });
  }
};

export default notifications; 