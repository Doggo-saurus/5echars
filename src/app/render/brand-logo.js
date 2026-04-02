export function createPersistentBrandLogo({ app }) {
  let persistentBrandLogoLink = null;

  function ensurePersistentBrandLogoLink() {
    if (persistentBrandLogoLink) return persistentBrandLogoLink;
    const link = document.createElement("a");
    link.className = "app-brand-link";
    link.href = "/";
    link.setAttribute("aria-label", "Go to home");

    const image = document.createElement("img");
    image.className = "app-brand-logo";
    image.src = "/icons/icon.svg";
    image.alt = "Action Surge logo";

    link.appendChild(image);
    persistentBrandLogoLink = link;
    return persistentBrandLogoLink;
  }

  function hydratePersistentBrandLogo() {
    const slot = app.querySelector("[data-brand-logo-slot]");
    if (!slot) return;
    slot.replaceWith(ensurePersistentBrandLogoLink());
  }

  return {
    ensurePersistentBrandLogoLink,
    hydratePersistentBrandLogo,
  };
}
