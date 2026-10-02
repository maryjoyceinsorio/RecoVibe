(function () {
  const storedNotifications = localStorage.getItem("recovibeNotifications");
  const notifications =
    storedNotifications === null
      ? Array.from({ length: 5 }, () => ({ read: false }))
      : JSON.parse(storedNotifications);
  const unreadCount = notifications.filter((item) => !item.read).length;
  const badge = document.getElementById("navNotifBadge");
  if (!badge) return;
  badge.textContent = unreadCount;
  badge.hidden = unreadCount === 0;
})();
