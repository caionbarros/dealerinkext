# DealerInk PDF Editor (extensão do Chrome)

Extensão do Chrome para editar PDFs e montar o pacote que vai para o banco:
girar, reordenar, excluir, juntar e separar páginas, editar texto, separar os
documentos por tipo, gerar a capa e baixar o resultado. Funciona para quem tem conta no DealerInk, com
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

## O que o editor faz

- **Aba Páginas:** girar, reordenar arrastando, excluir, juntar vários PDFs,
  desfazer e refazer, baixar tudo ou só as páginas selecionadas.
- **Editar texto:** clique duplo numa página (ou selecione uma página e clique
  em "Editar texto"). Clique numa linha para trocar o texto: o tamanho é o
  mesmo e a fonte é a padrão mais parecida (Helvetica, Times ou Courier, com
  negrito e itálico). O texto antigo sai do arquivo, não fica só escondido.
  "Adicionar texto" escreve em qualquer ponto da página. Clique com o botão
  direito numa alteração para desfazer só ela.
- **Aba Pacote para o banco:** os documentos são reconhecidos com as mesmas
  regras do DealerInk (23 tipos). Marque o que vai para o banco e ajuste a
  ordem. O que você desmarca fica lembrado para aquele tipo de documento.
- **Capa:** dados da concessionária (vêm da loja cadastrada no DealerInk e
  ficam lembrados), comprador, veículo, VIN (encontrado no próprio PDF), banco,
  observações e o índice dos documentos com as páginas. A capa sai em inglês,
  porque vai para um banco americano.

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
- `src/editor.ts`: o editor de páginas e as duas abas.
- `src/pageEditor.ts`: edição de texto de uma página.
- `src/packageView.ts` e `src/cover.ts`: pacote para o banco e capa.
- `src/redact.ts`: tira do arquivo o texto que foi substituído.
- `src/dealer/`: classificação de documentos copiada do DealerInk.
- `src/pdf.ts`: leitura (pdf.js) e montagem do PDF final (pdf-lib).
- `src/sources.ts`: obtém o PDF de um endereço, de um download ou de um arquivo.
- `src/auth.ts` e `src/authView.ts`: login, código de 6 dígitos e checagem do plano.
- `public/_locales`: textos em inglês, espanhol e português (o Chrome escolhe pelo idioma do navegador).

## Limitações conhecidas

- PDFs protegidos por senha ou com restrição de edição não podem ser editados.
- Campos de formulário preenchíveis podem perder a ligação ao juntar arquivos.
- A edição de texto usa as fontes padrão do PDF (Helvetica, Times, Courier). Uma
  fonte especial do formulário vira a padrão mais parecida, e caracteres fora do
  alfabeto latino não podem ser escritos.
- Texto desenhado dentro de formulários embutidos (XObjects) ou em páginas com
  imagens embutidas no conteúdo fica coberto, mas continua no arquivo.
- PDFs gerados direto na página (endereço `blob:`) não podem ser lidos pelo
  endereço. Nesse caso, baixe e arraste para o editor.
