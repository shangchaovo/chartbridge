// KLineCharts 9.8.12 (Apache-2.0) drops a quick second click when it is far
// from the first click. Preserve double-clicks while accepting separate anchors.
export function patchKLineCharts(source) {
  const original=`            if (manhattanDistance < 5 /* ManhattanDistance.DoubleClick */ && !this._cancelClick) {
                this._processEvent(compatEvent, this._handler.mouseDoubleClickEvent);
            }
            this._resetClickTimeout();`;
  const replacement=`            if (!this._cancelClick) {
                this._processEvent(compatEvent, manhattanDistance < 5 /* ManhattanDistance.DoubleClick */
                    ? this._handler.mouseDoubleClickEvent : this._handler.mouseClickEvent);
            }
            this._resetClickTimeout();`;
  const normalized=source.replaceAll('\r\n','\n');
  if(normalized.split(original).length!==2)throw new Error('KLineCharts mouse handler changed; review the rapid-anchor patch before building.');
  const completeOnDoubleClick=`                if (overlay.isDrawing() && progressInstancePaneId === paneId) {
                    overlay.forceComplete();`;
  const placeAnchorOnDoubleClick=`                if (overlay.isDrawing() && progressInstancePaneId === paneId) {
                    overlay.eventMoveForDrawing(_this._coordinateToPoint(overlay, event));
                    overlay.nextStep();`;
  if(normalized.split(completeOnDoubleClick).length!==2)throw new Error('KLineCharts drawing double-click handler changed; review the fixed-anchor patch.');
  // All offered tools have a fixed number of anchors. A double-click must not
  // finish a new tool with only one point when the preceding tool used that spot.
  return normalized.replace(original,replacement).replace(completeOnDoubleClick,placeAnchorOnDoubleClick);
}
