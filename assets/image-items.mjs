export function disambiguateNames(items) {
  const reserved=new Set(items.map(item=>item.originalName||item.file.name));
  const used=new Set();
  return items.map(item=>{
    const originalName=item.originalName||item.file.name;
    let displayName=item.displayName||originalName;
    if(used.has(displayName)){
      const dot=originalName.lastIndexOf('.');
      const stem=dot>0?originalName.slice(0,dot):originalName;
      const ext=dot>0?originalName.slice(dot):'';
      for(let n=2;;n++){
        const candidate=`${stem} (${n})${ext}`;
        if(!used.has(candidate)&&!reserved.has(candidate)){displayName=candidate;break;}
      }
    }
    used.add(displayName);
    return {...item,originalName,displayName};
  });
}

export function moveItem(items,id,to){
  const from=items.findIndex(item=>item.id===id);
  if(from<0||to<0||to>=items.length)return items;
  const result=[...items];result.splice(to,0,result.splice(from,1)[0]);return result;
}

export function removeItem(items,id){return items.filter(item=>item.id!==id);}

export async function imageSha256(file){
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
