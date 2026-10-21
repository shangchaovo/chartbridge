// Native onClick runs before KLineCharts commits its selected instance. These
// callbacks only reflect that event in the UI; writing back would reenter it.
export function drawingSelectionCallbacks(show,hide){
 return {
  onClick:({overlay})=>{if(overlay.groupId==='user-drawings'&&!overlay.isDrawing?.())show(overlay,false);return false;},
  onSelected:({overlay})=>{if(overlay.groupId==='user-drawings')show(overlay,false);return false;},
  onDeselected:({overlay})=>{hide(overlay.id);return false;},
 };
}
