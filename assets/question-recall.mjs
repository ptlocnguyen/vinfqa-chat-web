export function recallQuestion(messages,index,draft,direction,currentValue){
  const questions=messages.filter(item=>item.role==='user').map(item=>item.text);
  if(!questions.length||index<0&&direction!=='up'||index<0&&currentValue)return null;
  const original=index<0?currentValue:draft;
  const next=Math.max(0,Math.min(questions.length,(index<0?questions.length:index)+(direction==='up'?-1:1)));
  return {index:next,draft:original,value:next===questions.length?original:questions[next]};
}
