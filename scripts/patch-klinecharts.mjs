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
                    if (overlay.name === 'localPath' || overlay.name === 'localPolyline') {
                        if (overlay.points.length > overlay.currentStep - 1) overlay.points.length = Math.max(0, overlay.currentStep - 1);
                        overlay.forceComplete();
                    } else {
                        overlay.eventMoveForDrawing(_this._coordinateToPoint(overlay, event));
                        overlay.nextStep();
                    }`;
  if(normalized.split(completeOnDoubleClick).length!==2)throw new Error('KLineCharts drawing double-click handler changed; review the fixed-anchor patch.');
  const finishLoadedPoints=`            if (points.length >= this.totalStep - 1) {
                this.currentStep = OVERLAY_DRAW_STEP_FINISHED;
                repeatTotalStep = this.totalStep - 1;
            }`;
  const finishPathPoints=`            if (points.length >= this.totalStep - 1 || this.name === 'localPath' || this.name === 'localPolyline') {
                this.currentStep = OVERLAY_DRAW_STEP_FINISHED;
                repeatTotalStep = points.length;
            }`;
  if(normalized.split(finishLoadedPoints).length!==2)throw new Error('KLineCharts setPoints changed; review the path-restore patch.');
  // Fixed-anchor tools treat a double-click as one more anchor. Path and polyline
  // still finish on that double-click, and restoring fewer anchors must not resume drawing.
  return normalized.replace(original,replacement).replace(completeOnDoubleClick,placeAnchorOnDoubleClick).replace(finishLoadedPoints,finishPathPoints);
}
