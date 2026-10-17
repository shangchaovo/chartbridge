// Shared by the toolbar and server validation so every offered tool can be saved.
export const DRAWING_GROUPS = [
  {id:'lines',label:'线条与通道',icon:'trend',tools:[
    ['segment','趋势线','trend','Alt+T'],['rayLine','射线','ray','Alt+Y'],['straightLine','延长线','extended','Alt+E'],
    ['horizontalStraightLine','水平线','horizontal','Alt+H'],['horizontalRayLine','水平射线','horizontalRay','Alt+Shift+H'],
    ['horizontalSegment','水平线段','horizontalSegment','Alt+Shift+S'],['verticalStraightLine','垂直线','vertical','Alt+V'],
    ['crossLine','十字线','crosshair','Alt+C'],['parallelStraightLine','平行通道','channel','Alt+P'],['priceChannelLine','价格通道','channel','Alt+W'],
  ]},
  {id:'fibonacci',label:'斐波那契工具',icon:'fib',tools:[['fibonacciLine','斐波那契回撤','fib','Alt+F'],['fibExtension','趋势斐波那契扩展','fibExtension','Alt+Shift+F']]},
  {id:'shapes',label:'几何图形',icon:'rectangle',tools:[['rect','矩形','rectangle','Alt+Shift+R'],['localCircle','圆形','circle','Alt+O'],['localTriangle','三角形','triangle','Alt+Shift+O'],['arrowLine','箭头','arrow','Alt+Shift+A']]},
  {id:'notes',label:'文字与价格标注',icon:'text',tools:[['localNote','文字标注','text','Alt+N'],['priceLine','价格线','priceTag','Alt+K'],['simpleTag','价格标签','tag','Alt+Shift+K']]},
  {id:'measure',label:'测量工具',icon:'ruler',tools:[['priceRange','价格区间','priceRange','Alt+U'],['dateRange','时间区间','dateRange','Alt+Shift+D'],['datePriceRange','时间与价格区间','ruler','Alt+M']]},
];
export const DRAWING_TOOLS = DRAWING_GROUPS.flatMap(group => group.tools.map(([name,label,icon,shortcut]) => ({name,label,icon,shortcut,group:group.id})));
export const DRAWING_NAMES = Object.fromEntries(DRAWING_TOOLS.map(tool => [tool.name,tool.label]));
export const SAVED_DRAWING_TYPES = [...DRAWING_TOOLS.map(tool => tool.name),'simpleAnnotation','verticalRayLine','verticalSegment'];
