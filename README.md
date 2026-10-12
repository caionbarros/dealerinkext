# DealerInk PDF Editor (extensão do Chrome)

Extensão do Chrome para editar PDFs: girar, reordenar, excluir, juntar e separar
páginas, e baixar o resultado. Funciona para quem tem conta no DealerInk, com
verificação em duas etapas e concessionária com plano em vigor.

O PDF nunca sai do computador. O servidor (o mesmo backend do DealerInk) só
confirma quem é o usuário e se o plano está em vigor (`my_extension_access`,
migração 0028 do repositório dealerink).

## Como a extensão encontra os PDFs

- **Aba com PDF aberto:** o ícone da extensão mostra "PDF". Clique no ícone e
  em "Editar este PDF".
- **PDF baixado:** aparece uma notificação "PDF baixado" com o botão "Editar".
  Dá para desligar no popup da extensão.
- **Link para PDF:** botão direito no link, "Editar este PDF no DealerInk".
- **Arquivo no computador:** abra o editor e arraste o arquivo para a janela.

O Chrome não deixa extensões desenharem por cima do leitor de PDF dele. Por
isso a edição abre numa aba própria da extensão.

## Rodar localmente

```
npm install
npm run build
```

No Chrome: `chrome://extensions`, ligue o "Modo do desenvolvedor", clique em
"Carregar sem compactação" e escolha a pasta `dist`.

`npm run package` gera `dealerink-pdf-editor.zip` para enviar à Chrome Web Store.

## Estrutura

- `src/background.ts`: detecta PDFs (abas, downloads, menu do botão direito).
- `src/popup.ts`: janela do ícone da extensão.
- `src/editor.ts`: o editor de páginas.
- `src/pdf.ts`: leitura (pdf.js) e montagem do PDF final (pdf-lib).
- `src/sources.ts`: obtém o PDF de um endereço, de um download ou de um arquivo.
- `src/auth.ts` e `src/authView.ts`: login, código de 6 dígitos e checagem do plano.
- `public/_locales`: textos em inglês, espanhol e português (o Chrome escolhe pelo idioma do navegador).

## Limitações conhecidas

- PDFs protegidos por senha ou com restrição de edição não podem ser editados.
- Campos de formulário preenchíveis podem perder a ligação ao juntar arquivos.
- PDFs gerados direto na página (endereço `blob:`) não podem ser lidos pelo
  endereço. Nesse caso, baixe e arraste para o editor.
