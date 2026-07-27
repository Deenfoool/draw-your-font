const file=document.getElementById('file');
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');
const log=document.getElementById('log');
let image=null;

file.onchange=e=>{
 const f=e.target.files[0];
 if(!f)return;
 const img=new Image();
 img.onload=()=>{
  canvas.width=img.width;canvas.height=img.height;
  ctx.drawImage(img,0,0);
  image=img;
  log.textContent='Фото загружено. Кириллица включена: А-Я а-я Ёё';
 };
 img.src=URL.createObjectURL(f);
};

document.getElementById('process').onclick=()=>{
 if(!image)return log.textContent='Сначала загрузите фото';
 const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 let dark=0;
 for(let i=0;i<data.length;i+=4){if(data[i]<120)dark++}
 log.textContent=`Анализ завершён. Найдено тёмных пикселей: ${dark}\nСледующий этап: сегментация букв и сборка TTF.`;
};

document.getElementById('download').onclick=()=>{
 const blob=new Blob(['charset=АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'],{type:'text/plain'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='font-project.txt';a.click();
};