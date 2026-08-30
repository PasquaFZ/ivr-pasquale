const PERMISSIONS = {
  USERS_LIST: "users.list",
  USERS_READ: "users.read",
  USERS_UPDATE: "users.update",
  USERS_CREATE: "users.create",
  AUDIOS_PLAY: "audios.play",
  AUDIOS_DOWNLOAD: "audios.download",
};

const ALL = Object.values(PERMISSIONS);
const ALLOWED = new Set(ALL);
const PANEL_ROLES = new Set(["admin", "operator"]);

const BY_ROLE = {
  admin: ALL,
  operator: [
    PERMISSIONS.USERS_LIST,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.AUDIOS_PLAY,
  ],
  user: [],
};

function isPanelRole(role) {
  return PANEL_ROLES.has(role);
}

function sanitizePermissions(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((item) => ALLOWED.has(item)))];
}

function permissionsForRole(role) {
  return BY_ROLE[role] || [];
}

function permissionsForUser(user) {
  const stored = sanitizePermissions(user && user.Permissions);
  if (stored && stored.length) return stored;
  return permissionsForRole(user && user.Role);
}

function hasPermission(role, permission, stored) {
  const list = sanitizePermissions(stored);
  if (list) return list.includes(permission);
  return permissionsForRole(role).includes(permission);
}

module.exports = {
  PERMISSIONS,
  ALL,
  sanitizePermissions,
  permissionsForRole,
  permissionsForUser,
  hasPermission,
  isPanelRole,
};
