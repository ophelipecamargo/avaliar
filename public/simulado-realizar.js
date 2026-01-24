// simulado-realizar.js – CONTROLE DE ESTADO DA UI

function setUIState({ status, iniciado_em }) {
  const nav = document.getElementById("nav-botoes");
  const btnIniciar = document.getElementById("btn-iniciar");
  const boxAntes = document.getElementById("box-antes");
  const boxResultado = document.getElementById("box-resultado");

  const finalizado = (status === "enviado" || status === "expirado");
  const emAndamento = (status === "em_andamento");

  if (boxAntes) boxAntes.style.display = (!iniciado_em && !finalizado) ? "block" : "none";
  if (btnIniciar) btnIniciar.style.display = (!iniciado_em && !finalizado) ? "inline-flex" : "none";
  if (nav) nav.style.display = (iniciado_em && emAndamento) ? "flex" : "none";
  if (boxResultado) boxResultado.style.display = finalizado ? "block" : "none";
}
