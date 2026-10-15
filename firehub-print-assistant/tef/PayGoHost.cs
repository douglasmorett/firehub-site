// ─────────────────────────────────────────────────────────────────────────────
//  Motor TEF do Assistente FireHub — ponte com a PayGo Web (PGWebLib.dll)
//
//  Roda num PowerShell de 32 bits (SysWOW64) carregado por motor-paygo.ps1,
//  porque a DLL do kit costuma ser 32 bits e não carrega no Electron (x64).
//  Fala com o Assistente por JSON, UMA linha por mensagem, em stdin/stdout.
//  O protocolo está descrito em tef/index.js (o simulador fala o mesmo).
//
//  C# 5 de propósito (é o compilador do Add-Type do Windows PowerShell 5.1):
//  sem interpolação de string, sem "?.", sem membros "=>".
//
//  Uma transação por vez. As chamadas da DLL são bloqueantes e todas saem
//  desta MESMA thread (a principal); a thread de leitura só anota "cancelar" e
//  "responder" — quem chama PW_iPPAbort é o laço do pinpad, como no exemplo
//  oficial (github.com/adminti2/Integracao-PayGoWeb-CSharp, Fluxos.cs).
//
//  Os NÚMEROS (PWRET, PWDAT, PWINFO...) chegam do Assistente no "iniciar"
//  (tef/constantes.js): um lugar só para corrigir quando o .h do kit chegar.
// ─────────────────────────────────────────────────────────────────────────────
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class PayGoHost
{
    // ── Estruturas (exemplo oficial C#, ValueObjects/Structs/PW_GetData.cs) ──
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct TextoMenu { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 41)] public string szTextoMenu; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct ValorMenu { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szValorMenu; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct PW_GetData
    {
        public ushort wIdentificador;
        public byte bTipoDeDado;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szPrompt;
        public byte bNumOpcoesMenu;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 40)] public TextoMenu[] vszTextoMenu;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 40)] public ValorMenu[] vszValorMenu;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 41)] public string szMascaraDeCaptura;
        public byte bTiposEntradaPermitidos;
        public byte bTamanhoMinimo;
        public byte bTamanhoMaximo;
        public int ulValorMinimo;
        public int ulValorMaximo;
        public byte bOcultarDadosDigitados;
        public byte bValidacaoDado;
        public byte bAceitaNulo;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 41)] public string szValorInicial;
        public byte bTeclasDeAtalho;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szMsgValidacao;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szMsgConfirmacao;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szMsgDadoMaior;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szMsgDadoMenor;
        public byte bCapturarDataVencCartao;
        public int ulTipoEntradaCartao;
        public byte bItemInicial;
        public byte bNumeroCapturas;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 84)] public string szMsgPrevia;
        public byte bTipoEntradaCodigoBarras;
        public byte bOmiteMsgAlerta;
        public byte bStartFromLeft;
        public byte bNotificarCancelamento;
    }

    // ── Funções da DLL (StdCall, como no exemplo oficial — CONFERIR NO .h) ──
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_SetEnvironment(short iEnv);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_Init(string pszWorkingDir);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_NewTransac(byte bOper);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_AddParam(ushort wParam, string pszValue);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_ExecTransac([In, Out] PW_GetData[] vstParam, ref short piNumParam);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_GetResult(short iInfo, StringBuilder pszData, uint ulDataSize);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_Confirmation(uint ulResult, string pszReqNum, string pszLocRef, string pszExtRef, string pszVirtMerch, string pszAuthSyst);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_Vazia();
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_Indice(ushort uiIndex);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)] delegate short D_EventLoop(StringBuilder pszDisplay, uint ulDisplaySize);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string lpLibFileName);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetDllDirectoryW(string lpPathName);

    static IntPtr lib = IntPtr.Zero;
    static D_SetEnvironment PW_iSetEnvironment;
    static D_Init PW_iInit;
    static D_NewTransac PW_iNewTransac;
    static D_AddParam PW_iAddParam;
    static D_ExecTransac PW_iExecTransac;
    static D_GetResult PW_iGetResult;
    static D_Confirmation PW_iConfirmation;
    static D_Vazia PW_iIdleProc, PW_iPPAbort, PW_iPPRemoveCard;
    static D_Indice PW_iPPGetCard, PW_iPPGetPIN, PW_iPPGetData, PW_iPPGoOnChip, PW_iPPFinishChip, PW_iPPConfirmData,
                    PW_iPPGenericCMD, PW_iPPPositiveConfirmation, PW_iPPTestKey;
    static D_EventLoop PW_iPPEventLoop;

    // ── Estado ──
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static StreamWriter saida;
    static readonly object travaSaida = new object();
    static readonly BlockingCollection<Dictionary<string, object>> fila = new BlockingCollection<Dictionary<string, object>>();
    static volatile bool cancelar = false;
    static readonly AutoResetEvent chegouResposta = new AutoResetEvent(false);
    static string resposta = null;
    static bool respostaCancelada = false;
    static bool iniciado = false;
    static int idleProcMs = 30000;
    static DateTime proximoIdle = DateTime.MaxValue;
    static int ultimoRet = 0;
    static string ultimaMensagem = null;
    static Dictionary<string, object> K; // constantes vindas do Assistente

    static int C(string grupo, string nome)
    {
        var g = (Dictionary<string, object>)K[grupo];
        return Convert.ToInt32(g[nome]);
    }

    static void Emitir(Dictionary<string, object> m)
    {
        string linha = json.Serialize(m);
        lock (travaSaida) { saida.WriteLine(linha); saida.Flush(); }
    }

    static Dictionary<string, object> Ev(string nome)
    {
        var m = new Dictionary<string, object>();
        m["ev"] = nome;
        return m;
    }

    static void Log(string texto)
    {
        var m = Ev("log");
        m["mensagem"] = texto;
        Emitir(m);
    }

    static T Funcao<T>(string nome) where T : class
    {
        IntPtr p = GetProcAddress(lib, nome);
        if (p == IntPtr.Zero) throw new Exception("A DLL não tem a função " + nome + ".");
        return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T));
    }

    static string Texto(object o) { return o == null ? null : Convert.ToString(o); }

    public static void Rodar()
    {
        saida = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        var entrada = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

        var leitor = new Thread(delegate ()
        {
            try
            {
                string linha;
                while ((linha = entrada.ReadLine()) != null)
                {
                    if (linha.Trim().Length == 0) continue;
                    Dictionary<string, object> cmd;
                    try { cmd = json.Deserialize<Dictionary<string, object>>(linha); }
                    catch (Exception e) { Log("Comando ilegível: " + e.Message); continue; }
                    string nome = Texto(cmd.ContainsKey("cmd") ? cmd["cmd"] : null);
                    if (nome == "cancelar") { cancelar = true; continue; }
                    if (nome == "responder")
                    {
                        resposta = Texto(cmd.ContainsKey("valor") ? cmd["valor"] : null);
                        respostaCancelada = resposta == null;
                        chegouResposta.Set();
                        continue;
                    }
                    fila.Add(cmd);
                }
            }
            catch (Exception) { }
            // stdin fechou: o Assistente saiu ou nos matou. Fecha limpo.
            var sair = new Dictionary<string, object>();
            sair["cmd"] = "sair";
            fila.Add(sair);
        });
        leitor.IsBackground = true;
        leitor.Start();

        while (true)
        {
            Dictionary<string, object> cmd;
            if (!fila.TryTake(out cmd, 500))
            {
                if (iniciado && DateTime.Now >= proximoIdle)
                {
                    try { PW_iIdleProc(); } catch (Exception e) { Log("PW_iIdleProc: " + e.Message); }
                    proximoIdle = DateTime.Now.AddMilliseconds(idleProcMs);
                }
                continue;
            }
            string nome = Texto(cmd["cmd"]);
            try
            {
                if (nome == "sair") return;
                if (nome == "iniciar") Iniciar(cmd);
                else if (nome == "venda") Venda(cmd);
                else if (nome == "confirmar") Confirmar(cmd);
                else Log("Comando desconhecido: " + nome);
            }
            catch (Exception e)
            {
                var m = Ev(nome == "iniciar" ? "falhou" : "erro");
                m["id"] = cmd.ContainsKey("id") ? cmd["id"] : null;
                m["erro"] = e.Message;
                Emitir(m);
            }
            proximoIdle = DateTime.Now.AddMilliseconds(idleProcMs);
        }
    }

    static void Iniciar(Dictionary<string, object> cmd)
    {
        K = (Dictionary<string, object>)cmd["k"];
        string dll = Texto(cmd["dll"]);
        string pasta = Texto(cmd["pastaDeTrabalho"]);
        if (cmd.ContainsKey("idleProcSegundos") && cmd["idleProcSegundos"] != null)
            idleProcMs = Math.Max(5, Convert.ToInt32(cmd["idleProcSegundos"])) * 1000;

        if (string.IsNullOrEmpty(dll) || !File.Exists(dll))
            throw new Exception("A PGWebLib.dll não está em \"" + dll + "\". Copie a DLL do kit PayGo para lá (ver tef/README.md).");
        Directory.CreateDirectory(pasta);
        SetDllDirectoryW(Path.GetDirectoryName(dll));
        lib = LoadLibraryW(dll);
        if (lib == IntPtr.Zero)
        {
            int erro = Marshal.GetLastWin32Error();
            if (erro == 193)
                throw new Exception("A PGWebLib.dll é de outra arquitetura (32 x 64 bits). Troque \"arquitetura\" em tef.json para a da DLL.");
            throw new Exception("A PGWebLib.dll não carregou (erro do Windows " + erro + ").");
        }
        PW_iInit = Funcao<D_Init>("PW_iInit");
        PW_iNewTransac = Funcao<D_NewTransac>("PW_iNewTransac");
        PW_iAddParam = Funcao<D_AddParam>("PW_iAddParam");
        PW_iExecTransac = Funcao<D_ExecTransac>("PW_iExecTransac");
        PW_iGetResult = Funcao<D_GetResult>("PW_iGetResult");
        PW_iConfirmation = Funcao<D_Confirmation>("PW_iConfirmation");
        PW_iIdleProc = Funcao<D_Vazia>("PW_iIdleProc");
        PW_iPPAbort = Funcao<D_Vazia>("PW_iPPAbort");
        PW_iPPRemoveCard = Funcao<D_Vazia>("PW_iPPRemoveCard");
        PW_iPPEventLoop = Funcao<D_EventLoop>("PW_iPPEventLoop");
        PW_iPPGetCard = Funcao<D_Indice>("PW_iPPGetCard");
        PW_iPPGetPIN = Funcao<D_Indice>("PW_iPPGetPIN");
        PW_iPPGetData = Funcao<D_Indice>("PW_iPPGetData");
        PW_iPPGoOnChip = Funcao<D_Indice>("PW_iPPGoOnChip");
        PW_iPPFinishChip = Funcao<D_Indice>("PW_iPPFinishChip");
        PW_iPPConfirmData = Funcao<D_Indice>("PW_iPPConfirmData");
        PW_iPPGenericCMD = Funcao<D_Indice>("PW_iPPGenericCMD");
        PW_iPPPositiveConfirmation = Funcao<D_Indice>("PW_iPPPositiveConfirmation");
        PW_iPPTestKey = Funcao<D_Indice>("PW_iPPTestKey");

        // Ambiente (homologação/produção): só se tef.json disser o número.
        // Os valores de iEnv não estão na doc pública — CONFERIR NO .h DO KIT.
        if (cmd.ContainsKey("ambiente") && cmd["ambiente"] != null)
        {
            PW_iSetEnvironment = Funcao<D_SetEnvironment>("PW_iSetEnvironment");
            short rEnv = PW_iSetEnvironment(Convert.ToInt16(cmd["ambiente"]));
            if (rEnv != C("PWRET", "OK")) Log("PW_iSetEnvironment devolveu " + rEnv);
        }

        short r = PW_iInit(pasta);
        if (r != C("PWRET", "OK"))
            throw new Exception("PW_iInit devolveu " + r + ". " + (Resultado(C("PWINFO", "RESULTMSG")) ?? ""));
        iniciado = true;
        var m = Ev("pronto");
        m["motor"] = "paygo";
        m["arquitetura"] = IntPtr.Size == 4 ? "x86" : "x64";
        Emitir(m);
    }

    static string Resultado(int info)
    {
        var sb = new StringBuilder(20000);
        short r = PW_iGetResult((short)info, sb, (uint)sb.Capacity);
        return r == C("PWRET", "OK") ? sb.ToString() : null;
    }

    static void Display(string id, string texto)
    {
        if (texto == null) return;
        var m = Ev("display");
        m["id"] = id;
        m["mensagem"] = texto;
        Emitir(m);
    }

    static void Venda(Dictionary<string, object> cmd)
    {
        string id = Texto(cmd["id"]);
        cancelar = false;
        ultimaMensagem = null;
        int OK = C("PWRET", "OK"), MOREDATA = C("PWRET", "MOREDATA"), NOTHING = C("PWRET", "NOTHING");
        var respostas = cmd.ContainsKey("respostas") && cmd["respostas"] != null
            ? (Dictionary<string, object>)cmd["respostas"] : new Dictionary<string, object>();

        short ret = PW_iNewTransac((byte)Convert.ToInt32(cmd["operacao"]));
        if (ret == OK)
        {
            foreach (object o in (IEnumerable)cmd["params"])
            {
                var p = (Dictionary<string, object>)o;
                ret = PW_iAddParam((ushort)Convert.ToInt32(p["id"]), Texto(p["valor"]) ?? "");
                if (ret != OK) { ultimaMensagem = "PW_iAddParam(" + p["id"] + ") devolveu " + ret; break; }
            }
        }
        if (ret == OK)
        {
            while (true)
            {
                if (cancelar) { ret = (short)C("PWRET", "CANCEL"); ultimaMensagem = "OPERACAO CANCELADA"; break; }
                short n = 9; // "valor sugerido: 9" (doc)
                var dados = new PW_GetData[n];
                ret = PW_iExecTransac(dados, ref n);
                if (ret == NOTHING) { Thread.Sleep(100); continue; }
                if (ret != MOREDATA) break;
                bool seguiu = true;
                for (int i = 0; i < n && seguiu; i++) seguiu = Capturar(id, dados[i], i, respostas);
                if (!seguiu) { ret = (short)ultimoRet; break; }
            }
        }

        var m = Ev("resultado");
        m["id"] = id;
        m["ret"] = (int)ret;
        m["aprovado"] = ret == OK;
        m["mensagem"] = Resultado(C("PWINFO", "RESULTMSG")) ?? ultimaMensagem;
        m["requerConfirmacao"] = Resultado(C("PWINFO", "CNFREQ")) == "1";
        var cnf = new Dictionary<string, object>();
        cnf["reqNum"] = Resultado(C("PWINFO", "REQNUM")) ?? "";
        cnf["locRef"] = Resultado(C("PWINFO", "AUTLOCREF")) ?? "";
        cnf["extRef"] = Resultado(C("PWINFO", "AUTEXTREF")) ?? "";
        cnf["virtMerch"] = Resultado(C("PWINFO", "VIRTMERCH")) ?? "";
        cnf["authSyst"] = Resultado(C("PWINFO", "AUTHSYST")) ?? "";
        m["confirmacao"] = cnf;
        if (ret == C("PWRET", "FROMHOSTPENDTRN"))
        {
            var pnd = new Dictionary<string, object>();
            pnd["reqNum"] = Resultado(C("PWINFO", "PNDREQNUM")) ?? "";
            pnd["locRef"] = Resultado(C("PWINFO", "PNDAUTLOCREF")) ?? "";
            pnd["extRef"] = Resultado(C("PWINFO", "PNDAUTEXTREF")) ?? "";
            pnd["virtMerch"] = Resultado(C("PWINFO", "PNDVIRTMERCH")) ?? "";
            pnd["authSyst"] = Resultado(C("PWINFO", "PNDAUTHSYST")) ?? "";
            m["pendenteNoHost"] = pnd;
        }
        var info = new Dictionary<string, object>();
        foreach (var par in (Dictionary<string, object>)cmd["resultados"])
        {
            string v = Resultado(Convert.ToInt32(par.Value));
            if (v != null) info[par.Key] = v;
        }
        m["info"] = info;
        Emitir(m);
    }

    /// Uma captura pedida por PWRET_MOREDATA. false = a transação acaba aqui
    /// (ultimoRet diz por quê).
    static bool Capturar(string id, PW_GetData d, int indice, Dictionary<string, object> respostas)
    {
        int OK = C("PWRET", "OK");
        int tipo = d.bTipoDeDado;
        ushort ix = (ushort)indice;
        string chave = d.wIdentificador.ToString();

        if (tipo == C("PWDAT", "MENU") || tipo == C("PWDAT", "TYPED"))
        {
            string valor = null;
            if (respostas.ContainsKey(chave)) valor = Texto(respostas[chave]);
            else if (tipo == C("PWDAT", "MENU") && d.bNumOpcoesMenu == 1) valor = d.vszValorMenu[0].szValorMenu;
            else valor = Perguntar(id, d);
            if (valor == null) { ultimoRet = C("PWRET", "CANCEL"); ultimaMensagem = "OPERACAO CANCELADA"; return false; }
            short r = PW_iAddParam(d.wIdentificador, valor);
            if (r != OK) { ultimoRet = r; return false; }
            return true;
        }
        if (tipo == C("PWDAT", "DSPCHECKOUT"))
        {
            Display(id, d.szPrompt);
            short r = PW_iAddParam(d.wIdentificador, "");
            if (r != OK) { ultimoRet = r; return false; }
            return true;
        }
        if (tipo == C("PWDAT", "CARDINF"))
        {
            if (d.ulTipoEntradaCartao == 1)
            {
                ultimoRet = C("PWRET", "CANCEL");
                ultimaMensagem = "Cartao digitado nao e aceito no totem.";
                return false;
            }
            return Pinpad(id, PW_iPPGetCard(ix));
        }
        if (tipo == C("PWDAT", "PPENTRY")) return Pinpad(id, PW_iPPGetData(ix));
        if (tipo == C("PWDAT", "PPENCPIN")) return Pinpad(id, PW_iPPGetPIN(ix));
        if (tipo == C("PWDAT", "CARDOFF")) return Pinpad(id, PW_iPPGoOnChip(ix));
        if (tipo == C("PWDAT", "CARDONL")) return Pinpad(id, PW_iPPFinishChip(ix));
        if (tipo == C("PWDAT", "PPCONF")) return Pinpad(id, PW_iPPConfirmData(ix));
        if (tipo == C("PWDAT", "PPREMCRD")) return Pinpad(id, PW_iPPRemoveCard());
        if (tipo == C("PWDAT", "PPGENCMD")) return Pinpad(id, PW_iPPGenericCMD(ix));
        if (tipo == C("PWDAT", "PPDATAPOSCNF")) return Pinpad(id, PW_iPPPositiveConfirmation(ix));
        if (tipo == C("PWDAT", "TSTKEY")) return Pinpad(id, PW_iPPTestKey(ix));

        // QR da carteira digital, código de barras, senha de usuário: o totem
        // não tem como capturar. A PayGo não deve pedir com o AUTCAP que
        // mandamos; se pedir, a transação para com motivo claro.
        ultimoRet = C("PWRET", "CANCEL");
        ultimaMensagem = "Captura nao suportada no totem (tipo " + tipo + ").";
        return false;
    }

    static string Perguntar(string id, PW_GetData d)
    {
        var m = Ev("pergunta");
        m["id"] = id;
        m["identificador"] = (int)d.wIdentificador;
        m["tipo"] = d.bTipoDeDado == C("PWDAT", "MENU") ? "menu" : "digitar";
        m["prompt"] = d.szPrompt;
        var opcoes = new List<object>();
        for (int i = 0; i < d.bNumOpcoesMenu && i < 40; i++)
        {
            var o = new Dictionary<string, object>();
            o["texto"] = d.vszTextoMenu[i].szTextoMenu;
            o["valor"] = d.vszValorMenu[i].szValorMenu;
            opcoes.Add(o);
        }
        m["opcoes"] = opcoes;
        m["minimo"] = (int)d.bTamanhoMinimo;
        m["maximo"] = (int)d.bTamanhoMaximo;
        m["ocultar"] = d.bOcultarDadosDigitados == 1;
        chegouResposta.Reset();
        resposta = null;
        respostaCancelada = false;
        Emitir(m);
        DateTime limite = DateTime.Now.AddSeconds(120);
        while (DateTime.Now < limite)
        {
            if (cancelar) return null;
            if (chegouResposta.WaitOne(200)) return respostaCancelada ? null : resposta;
        }
        return null;
    }

    static bool Pinpad(string id, short inicio)
    {
        int OK = C("PWRET", "OK"), DISPLAY = C("PWRET", "DISPLAY"), NOTHING = C("PWRET", "NOTHING");
        if (inicio != OK) { ultimoRet = inicio; return false; }
        var visor = new StringBuilder(1000); // mínimo recomendado: 100
        while (true)
        {
            visor.Length = 0;
            short r = PW_iPPEventLoop(visor, (uint)visor.Capacity);
            if (r == OK) return true;
            if (r == DISPLAY) Display(id, visor.ToString());
            else if (r != NOTHING && r != C("PWRET", "FALLBACK")) { ultimoRet = r; return false; }
            if (cancelar)
            {
                cancelar = false;
                PW_iPPAbort();
                ultimoRet = C("PWRET", "CANCEL");
                ultimaMensagem = "OPERACAO CANCELADA";
                return false;
            }
            Thread.Sleep(100); // a doc pede >= 100 ms entre chamadas
        }
    }

    static void Confirmar(Dictionary<string, object> cmd)
    {
        var refs = (Dictionary<string, object>)cmd["ref"];
        uint status = Convert.ToUInt32(cmd["status"]);
        short r = PW_iConfirmation(status, Texto(refs["reqNum"]) ?? "", Texto(refs["locRef"]) ?? "",
            Texto(refs["extRef"]) ?? "", Texto(refs["virtMerch"]) ?? "", Texto(refs["authSyst"]) ?? "");
        var m = Ev("confirmado");
        m["id"] = cmd.ContainsKey("id") ? cmd["id"] : null;
        m["ok"] = r == C("PWRET", "OK");
        m["ret"] = (int)r;
        Emitir(m);
    }
}
