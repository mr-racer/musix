import css from "./YandexBadge.module.css";

/** Yandex Music's mark since its 2023 rebrand — the yellow «impulse», twelve rays of uneven
 *  length, the long ones to the left and down — traced from the brand image (sostav.ru,
 *  2023-12-01) and set small on a dark lens, for the playlists the Yandex import made. The
 *  flash turns a little and flares when the card under it is hovered. */
const IMPULSE =
  "M1.06,9.65L1.09,9.30L10.74,8.91L3.82,4.44L4.00,4.17L11.16,6.76L8.21,1.54L8.46,1.40L13.46,6.00L13.77,1.00L14.04,1.01L15.62,6.35L18.07,2.67L18.28,2.80L17.24,7.16L21.00,5.28L21.14,5.49L18.41,8.67L22.68,9.01L22.73,9.27L18.70,10.34L22.94,13.06L22.88,13.32L18.46,12.11L21.68,17.32L21.49,17.55L17.42,14.03L18.55,20.79L18.27,20.93L15.17,14.30L11.58,23.00L11.24,22.94L13.12,12.79L3.10,18.72L2.89,18.43L11.91,10.94Z";

export function YandexBadge({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `${css.badge} ${className}` : css.badge} style={{ width: size, height: size }}
      title="Из Яндекс Музыки" aria-label="Из Яндекс Музыки" role="img">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className={css.rays} d={IMPULSE} />
      </svg>
    </span>
  );
}
